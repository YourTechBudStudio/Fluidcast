import {
  type Cause,
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Fiber,
  Layer,
  Queue,
  Stream,
} from 'effect';
import { type AiError, LanguageModel, type Response } from 'effect/ai';

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
    /** Input tokens read from, and written to, the provider's prompt cache. */
    readonly cacheReadInputTokens?: number;
    readonly cacheWriteInputTokens?: number;
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
 * How long the log keeps reading after Core accepted a reply, to record the finish part's usage.
 * After `]` the provider normally finishes within milliseconds; the limit caps the extra output paid
 * for and how long the HTTP stream stays open.
 */
const drainLimit = Duration.seconds(2);

/** The hand-off between the provider and Core: the provider is read at Core's pace. */
export const handOffCapacity = 1;

/**
 * Wraps the `LanguageModel` so every streamed generation is appended to `path` as one JSON line:
 * the prompt, the raw reply, the finish reason and token usage, including prompt-cache reads and
 * writes. A development aid for seeing why the model's output failed to parse; writing the log
 * never affects generation.
 *
 * Core stops reading at the reply's closing `]`, before the provider's finish part, which carries
 * the usage. So a reader fiber in the layer's scope reads the provider stream and hands each part
 * to Core through a bounded queue. When Core's side ends on a reply Core accepted, the reader stops
 * handing parts over and keeps reading to the finish part, for at most `drainLimit`; otherwise it
 * is interrupted at once. The reader writes the record when it ends.
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
      const scope = yield* Effect.scope;
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
        Stream.unwrap(
          Effect.gen(function* () {
            const started = Date.now();
            let output = '';
            let reasoning = '';
            let finish: GenerationRecord['finish'];
            let failure: AiError.AiError | undefined;
            const handOff = yield* Queue.bounded<Response.AnyPart, AiError.AiError | Cause.Done>(
              handOffCapacity,
            );
            const draining = yield* Deferred.make<void>();

            const read = inner.streamText(options as Parameters<typeof inner.streamText>[0]).pipe(
              Stream.tap((part) =>
                Effect.sync(() => {
                  if (part.type === 'text-delta') output += part.delta;
                  else if (part.type === 'reasoning-delta') reasoning += part.delta;
                  else if (part.type === 'finish') finish = finishOf(part);
                }),
              ),
              Stream.tapError((error) => Effect.sync(() => (failure = error))),
              Stream.runIntoQueue(handOff),
            );
            const reader = yield* Effect.raceFirst(
              read,
              // The limit starts only once Core has accepted the reply.
              Deferred.await(draining).pipe(Effect.andThen(Effect.sleep(drainLimit))),
            ).pipe(
              Effect.onExit(() =>
                ending(failure, output, finish !== undefined, speakerIds).pipe(
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
              Effect.forkIn(scope),
            );

            return Stream.fromQueue(handOff).pipe(
              Stream.onExit(() =>
                Effect.gen(function* () {
                  if ((yield* verdict(output, speakerIds))._tag === 'Success') {
                    // Core has the whole reply: stop handing parts over, so the reader never
                    // waits on Core, and let it read on to the finish part.
                    yield* Queue.shutdown(handOff);
                    yield* Deferred.succeed(draining, undefined);
                  } else {
                    yield* Fiber.interrupt(reader);
                  }
                }),
              ),
            );
          }),
        );

      // `streamText` is overloaded for toolkits, which Core never passes; this wrapper forwards
      // every call unchanged and only observes the parts.
      return { ...inner, streamText: streamText as unknown as typeof inner.streamText };
    }),
  );

/** The finish part's reason and token counts, including prompt-cache reads and writes. */
const finishOf = (part: Response.FinishPart): NonNullable<GenerationRecord['finish']> => ({
  reason: part.reason,
  ...(part.usage.inputTokens.total === undefined
    ? {}
    : { inputTokens: part.usage.inputTokens.total }),
  ...(part.usage.outputTokens.total === undefined
    ? {}
    : { outputTokens: part.usage.outputTokens.total }),
  ...(part.usage.inputTokens.cacheRead === undefined
    ? {}
    : { cacheReadInputTokens: part.usage.inputTokens.cacheRead }),
  ...(part.usage.inputTokens.cacheWrite === undefined
    ? {}
    : { cacheWriteInputTokens: part.usage.inputTokens.cacheWrite }),
});

/** Core's verdict on the observed reply, from Core's own parser. */
const verdict = (output: string, speakerIds: ReadonlySet<string>) =>
  parseActions(Stream.succeed(output), { speakerIds }).pipe(Stream.runDrain, Effect.result);

/**
 * How a generation ended. The reader cannot see Core's outcome, so the observed reply is run back
 * through Core's own parser, which gives the same verdict Core reached.
 */
const ending = (
  failure: AiError.AiError | undefined,
  output: string,
  finished: boolean,
  speakerIds: ReadonlySet<string>,
): Effect.Effect<Pick<GenerationRecord, 'ended' | 'error'>> =>
  Effect.gen(function* () {
    if (failure !== undefined) {
      return { ended: 'failed', error: { tag: failure.reason._tag } } as const;
    }
    const parsed = yield* verdict(output, speakerIds);
    if (parsed._tag === 'Success') return { ended: 'completed' } as const;
    const error = parsed.failure;
    switch (error._tag) {
      case 'InvalidAction':
        return {
          ended: 'failed',
          error: { tag: error._tag, index: error.index, reason: error.reason },
        } as const;
      case 'MalformedOutput':
        // A reply that stops short is only malformed if the provider finished it that way.
        return finished
          ? ({ ended: 'failed', error: { tag: error._tag, reason: error.reason } } as const)
          : ({ ended: 'cancelled' } as const);
    }
  });
