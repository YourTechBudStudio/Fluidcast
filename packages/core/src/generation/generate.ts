import { Duration, Effect, Option, Stream } from 'effect';
import { AiError, LanguageModel, type Response } from 'effect/ai';

import type { Action, Speak, SpeakerProfile } from '../actions/index.ts';
import { withCacheBreakpoints } from './cache.ts';
import { ProviderError, type GenerationError } from './errors.ts';
import type { Example } from './examples.ts';
import { renderHistory } from './history.ts';
import { parseActions } from './parser.ts';
import { buildSystemPrompt } from './prompt.ts';
import type { Reminders } from './reminders.ts';
import type { ToolCallDraft, ToolDefinition } from './tools.ts';

export interface GenerateOptions {
  /** Integrator instructions placed in the system prompt. */
  readonly instructions: string;
  /**
   * Integrator worked examples, rendered after the output format like history. Each may use only
   * the configured tools; one that does not fit them is a configuration defect and throws.
   */
  readonly examples?: ReadonlyArray<Example>;
  /** The configured speakers. The first is the lead speaker. At least one is required. */
  readonly speakers: ReadonlyArray<SpeakerProfile>;
  /** The actions that have taken effect, oldest first. */
  readonly history: ReadonlyArray<Action>;
  /** The tools the model may call, in prompt order. Empty for a speech-only conversation. */
  readonly tools: ReadonlyArray<ToolDefinition>;
  /**
   * The configuration's reminders for the newest input, rendered after it and never in the system
   * prompt. Absent: no reminders.
   */
  readonly reminders?: Reminders;
  /**
   * The history may open with an `<earlier_conversation>` summary: the system prompt explains it.
   * Keep it fixed for a session, so the prompt stays cacheable. Unset: the prompt is unchanged.
   */
  readonly summarizedHistory?: boolean;
  /**
   * Also report the provider's input-token count. Unset: the stream ends at the reply's closing
   * `]` and nothing is drained.
   */
  readonly usage?: boolean;
}

/** With `usage`: the reply closed at its `]` and every action has been emitted. */
export interface ReplyEnded {
  readonly type: 'reply_ended';
}

/**
 * With `usage`: the provider's input-token count for the generation, including cached input
 * (`usage.inputTokens.total`). Emitted at most once, after `ReplyEnded`.
 */
export interface GenerationUsage {
  readonly type: 'usage';
  readonly inputTokens: number;
}

/**
 * How long `generate` keeps reading after the reply's `]` for the finish part's usage. After `]`
 * the provider normally finishes within milliseconds; the limit caps the extra output paid for and
 * how long the stream stays open.
 */
const drainLimit = Duration.seconds(2);

/**
 * Generates the model's next actions from caller-owned history. Each action is emitted, with a
 * fresh ID, as soon as its array element closes. A tool call is emitted as a draft without a
 * handle, unchecked: the caller assigns its handle and validates it when it takes effect. Core
 * stores nothing; the provider and API come from the `LanguageModel` layer the caller supplies.
 * The prompt always marks the end of its stable prefix as provider cache breakpoints
 * (`withCacheBreakpoints`), so callers get prompt caching without configuration.
 *
 * With `usage`, a `ReplyEnded` follows the last action as soon as the reply's `]` closes; the
 * stream then reads on for at most `drainLimit` and emits a `GenerationUsage` if the provider's
 * finish part arrives with a total. Neither is an action. Without a count in time, or when the
 * provider fails after `]`, the stream ends with no usage: the reply was already accepted, so it is
 * not a failure.
 */
export function generate(
  options: GenerateOptions & { readonly usage: true },
): Stream.Stream<
  Speak | ToolCallDraft | ReplyEnded | GenerationUsage,
  GenerationError,
  LanguageModel.LanguageModel
>;
export function generate(
  options: GenerateOptions & { readonly usage?: false },
): Stream.Stream<Speak | ToolCallDraft, GenerationError, LanguageModel.LanguageModel>;
export function generate(
  options: GenerateOptions,
): Stream.Stream<
  Speak | ToolCallDraft | ReplyEnded | GenerationUsage,
  GenerationError,
  LanguageModel.LanguageModel
>;
export function generate(
  options: GenerateOptions,
): Stream.Stream<
  Speak | ToolCallDraft | ReplyEnded | GenerationUsage,
  GenerationError,
  LanguageModel.LanguageModel
> {
  return Stream.suspend(() => {
    const prompt = withCacheBreakpoints([
      { role: 'system', content: buildSystemPrompt(options) },
      ...renderHistory(
        options.history,
        options.tools,
        options.reminders === undefined ? {} : { reminders: options.reminders },
      ),
    ]);
    const parts = LanguageModel.streamText({ prompt }).pipe(Stream.mapError(toProviderError));
    const parse = <R>(provider: Stream.Stream<Part, ProviderError, R>) =>
      parseActions(Stream.flatMap(provider, textOf), {
        speakerIds: new Set(options.speakers.map((speaker) => speaker.id)),
      });
    if (options.usage !== true) return parse(parts);
    // One part per pull, so the parser stops right after the part that closes the reply and the
    // drain reads on from the same provider stream.
    return Stream.unwrap(
      Effect.map(Stream.toPull(Stream.rechunk(parts, 1)), (pull) => {
        const remaining = Stream.fromPull(Effect.succeed(pull));
        return parse(remaining).pipe(
          Stream.concat(Stream.succeed<ReplyEnded>({ type: 'reply_ended' })),
          Stream.concat(
            Stream.unwrap(
              Effect.map(inputTokens(remaining), (total) =>
                total === undefined
                  ? Stream.empty
                  : Stream.succeed<GenerationUsage>({ type: 'usage', inputTokens: total }),
              ),
            ),
          ),
        );
      }),
    );
  });
}

/** A provider stream part, as `LanguageModel.streamText` emits it without a toolkit. */
export type Part = Response.StreamPart<{}>;

/** A text delta as text; an error part fails the generation. */
export const textOf = (part: Part): Stream.Stream<string, ProviderError> => {
  switch (part.type) {
    case 'text-delta':
      return Stream.succeed(part.delta);
    case 'error':
      return Stream.fail(new ProviderError({ reason: 'ErrorPart' }));
    default:
      return Stream.empty;
  }
};

/**
 * The finish part's input total from the rest of the provider stream, read for at most
 * `drainLimit`. Absent when it does not arrive in time, the stream ends or fails first, or the
 * provider reports no total.
 */
const inputTokens = (
  remaining: Stream.Stream<Part, ProviderError>,
): Effect.Effect<number | undefined> =>
  remaining.pipe(
    Stream.filter((part): part is Response.FinishPart => part.type === 'finish'),
    Stream.runHead,
    Effect.timeoutOption(drainLimit),
    Effect.map((found) => Option.getOrUndefined(Option.flatten(found))?.usage.inputTokens.total),
    Effect.orElseSucceed(() => undefined),
  );

/** Keeps only identifiers from the provider failure; its message text may echo the prompt. */
export const toProviderError = (error: AiError.AiError): ProviderError => {
  const reason = error.reason;
  const status = 'http' in reason ? reason.http?.response?.status : undefined;
  return new ProviderError({
    reason: reason._tag,
    ...(status === undefined ? {} : { status }),
    ...providerCode('metadata' in reason ? reason.metadata : undefined),
  });
};

/** Provider metadata is keyed by provider name, e.g. `{ openai: { errorCode, errorType } }`. */
const providerCode = (metadata: unknown): { readonly code?: string } => {
  if (typeof metadata !== 'object' || metadata === null) return {};
  for (const entry of Object.values(metadata)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const code: unknown = 'errorCode' in entry ? entry.errorCode : undefined;
    const type: unknown = 'errorType' in entry ? entry.errorType : undefined;
    if (typeof code === 'string' || typeof code === 'number') return { code: String(code) };
    if (typeof type === 'string') return { code: type };
  }
  return {};
};
