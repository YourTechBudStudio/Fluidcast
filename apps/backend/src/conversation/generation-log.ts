import { Effect, Exit, FileSystem, Layer, Option, Stream } from 'effect';
import { AiError, LanguageModel } from 'effect/unstable/ai';

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
   * - `completed`: the provider finished the reply (a `finish` part arrived).
   * - `cancelled`: the reader stopped first: Core stops at the closing `]` and on an invalid
   *   element, and an interrupt cancels generation. The server log's `generation failed` warning
   *   says which failure, if any.
   * - `failed`: the provider failed; `error` is its reason tag.
   */
  readonly ended: 'completed' | 'cancelled' | 'failed';
  readonly error?: string;
}

/**
 * Wraps the `LanguageModel` so every streamed generation is appended to `path` as one JSON line:
 * the prompt, the raw reply, the finish reason and token usage. A development aid for seeing why
 * the model's output failed to parse; writing the log never affects generation.
 */
export const withGenerationLog = (
  path: string,
  model: string,
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
              append({
                startedAt: new Date(started).toISOString(),
                durationMs: Date.now() - started,
                model,
                prompt: options.prompt,
                output,
                ...(reasoning === '' ? {} : { reasoning }),
                ...(finish === undefined ? {} : { finish }),
                ...ending(exit, finish !== undefined),
              }),
            ),
          );
        });

      // `streamText` is overloaded for toolkits, which Core never passes; this wrapper forwards
      // every call unchanged and only observes the parts.
      return { ...inner, streamText: streamText as unknown as typeof inner.streamText };
    }),
  );

/**
 * How a generation ended, from what was observed rather than from how its stream was closed: a
 * failure downstream (Core rejecting an element) also reaches this stream as a failure.
 */
const ending = (exit: Exit.Exit<unknown, unknown>, finished: boolean) => {
  const error = Exit.findErrorOption(exit);
  if (Option.isSome(error) && AiError.isAiError(error.value)) {
    return { ended: 'failed' as const, error: error.value.reason._tag };
  }
  return { ended: finished ? ('completed' as const) : ('cancelled' as const) };
};
