import { Effect, Exit, FileSystem, Layer, Option, Stream } from 'effect';
import { AiError, LanguageModel } from 'effect/unstable/ai';

import { parseActions } from '@yourtechbudstudio/fluidcast-core/generation';

/**
 * One generation as the model saw and answered it. Holds conversation content, so it is written
 * only when `debug.generationLog` is configured.
 */
interface GenerationRecord {
  readonly startedAt: string;
  readonly durationMs: number;
  readonly model: string;
  /** The messages exactly as Core sent them: the system prompt, then the rendered history. */
  readonly prompt: unknown;
  /** The raw reply text, before parsing. */
  readonly output: string;
  /** Reasoning text, when the provider streams it separately. */
  readonly reasoning?: string;
  /** The provider's finish reason and token counts, when the stream got that far. */
  readonly finish?: {
    readonly reason: string;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
  /**
   * Core's verdict on the reply, from its own parser:
   * - `completed`: Core accepted every action through the closing `]`. `finish` may be absent,
   *   because Core stops reading there.
   * - `failed`: the provider failed, or Core rejected the reply; `error` says which and where.
   * - `cancelled`: generation stopped before the reply was done and before anything was wrong
   *   with it, as when the listener interrupts.
   */
  readonly ended: 'completed' | 'cancelled' | 'failed';
  readonly error?: GenerationLogError;
}

/**
 * Why a generation failed: the provider's reason tag, or Core's error tag with the element
 * `index` and `reason` it carries.
 */
interface GenerationLogError {
  readonly tag: string;
  readonly index?: number;
  readonly reason?: string;
}

/**
 * Wraps the `LanguageModel` so every streamed generation is appended to `path` as one JSON line:
 * the prompt, the raw reply, the finish reason and token usage. A development aid for seeing why
 * the model's output failed to parse; writing the log never affects generation.
 */
export const withGenerationLog = (
  path: string,
  model: string,
  speakerIds: ReadonlySet<string>,
): Layer.Layer<
  LanguageModel.LanguageModel,
  never,
  LanguageModel.LanguageModel | FileSystem.FileSystem
> =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const inner = yield* LanguageModel.LanguageModel;
      const fs = yield* FileSystem.FileSystem;
      yield* Effect.logWarning(
        'generation log is on: prompts and replies, including conversation text, are written to it',
      ).pipe(Effect.annotateLogs({ path }));

      const append = (record: GenerationRecord) =>
        fs
          .writeFileString(path, `${JSON.stringify(record)}\n`, { flag: 'a' })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning('generation log: write failed').pipe(
                Effect.annotateLogs({ path, reason: error._tag }),
              ),
            ),
          );

      const streamText = (options: { readonly prompt: unknown }) =>
        Stream.suspend(() => {
          const started = Date.now();
          let output = '';
          let reasoning = '';
          let finish: GenerationRecord['finish'];
          return inner.streamText(options as Parameters<typeof inner.streamText>[0]).pipe(
            Stream.tap((part) =>
              Effect.sync(() => {
                if (part.type === 'text-delta') output += part.delta;
                else if (part.type === 'reasoning-delta') reasoning += part.delta;
                else if (part.type === 'finish') {
                  finish = {
                    reason: part.reason,
                    ...(part.usage.inputTokens.total === undefined
                      ? {}
                      : { inputTokens: part.usage.inputTokens.total }),
                    ...(part.usage.outputTokens.total === undefined
                      ? {}
                      : { outputTokens: part.usage.outputTokens.total }),
                  };
                }
              }),
            ),
            Stream.onExit((exit) =>
              ending(exit, output, finish !== undefined, speakerIds).pipe(
                Effect.flatMap((ended) =>
                  append({
                    startedAt: new Date(started).toISOString(),
                    durationMs: Date.now() - started,
                    model,
                    prompt: options.prompt,
                    output,
                    ...(reasoning === '' ? {} : { reasoning }),
                    ...(finish === undefined ? {} : { finish }),
                    ...ended,
                  }),
                ),
              ),
            ),
          );
        });

      // `streamText` is overloaded for toolkits, which Core never passes; this wrapper forwards
      // every call unchanged and only observes the parts.
      return { ...inner, streamText: streamText as unknown as typeof inner.streamText };
    }),
  );

/**
 * How a generation ended. This stream cannot see Core's outcome: when Core stops reading, at the
 * closing `]` or on an invalid element, it is interrupted either way. So the observed reply is run
 * back through Core's own parser, which gives the same verdict Core reached.
 */
const ending = (
  exit: Exit.Exit<unknown, unknown>,
  output: string,
  finished: boolean,
  speakerIds: ReadonlySet<string>,
): Effect.Effect<Pick<GenerationRecord, 'ended' | 'error'>> =>
  Effect.gen(function* () {
    const error = Exit.findErrorOption(exit);
    if (Option.isSome(error) && AiError.isAiError(error.value)) {
      return { ended: 'failed', error: { tag: error.value.reason._tag } } as const;
    }
    const parsed = yield* parseActions(Stream.succeed(output), { speakerIds }).pipe(
      Stream.runDrain,
      Effect.result,
    );
    if (parsed._tag === 'Success') return { ended: 'completed' } as const;
    const failure = parsed.failure;
    switch (failure._tag) {
      case 'InvalidAction':
        return {
          ended: 'failed',
          error: { tag: failure._tag, index: failure.index, reason: failure.reason },
        } as const;
      case 'MalformedOutput':
        // A reply that stops short is only malformed if the provider finished it that way.
        return finished
          ? ({ ended: 'failed', error: { tag: failure._tag, reason: failure.reason } } as const)
          : ({ ended: 'cancelled' } as const);
    }
  });
