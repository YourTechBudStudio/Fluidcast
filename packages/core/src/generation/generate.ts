import { Stream } from 'effect';
import { AiError, LanguageModel } from 'effect/unstable/ai';

import type { Action, Speak, SpeakerProfile } from '../actions/index.ts';
import { ProviderError, type GenerationError } from './errors.ts';
import { renderHistory } from './history.ts';
import { parseActions } from './parser.ts';
import { buildSystemPrompt } from './prompt.ts';

export interface GenerateOptions {
  /** Integrator instructions placed in the system prompt. */
  readonly instructions: string;
  /** The configured speakers. The first is the lead speaker. At least one is required. */
  readonly speakers: ReadonlyArray<SpeakerProfile>;
  /** The actions that have taken effect, oldest first. */
  readonly history: ReadonlyArray<Action>;
}

/**
 * Generates the model's next actions from caller-owned history. Each `speak` is emitted, with a
 * fresh ID, as soon as its array element closes. Core stores nothing; the provider and API come
 * from the `LanguageModel` layer the caller supplies.
 */
export const generate = (
  options: GenerateOptions,
): Stream.Stream<Speak, GenerationError, LanguageModel.LanguageModel> =>
  Stream.suspend(() => {
    const prompt = [
      { role: 'system' as const, content: buildSystemPrompt(options) },
      ...renderHistory(options.history),
    ];
    const text = LanguageModel.streamText({ prompt }).pipe(
      Stream.mapError(toProviderError),
      Stream.flatMap((part) => {
        switch (part.type) {
          case 'text-delta':
            return Stream.succeed(part.delta);
          case 'error':
            return Stream.fail(new ProviderError({ reason: 'ErrorPart' }));
          default:
            return Stream.empty;
        }
      }),
    );
    return parseActions(text, {
      speakerIds: new Set(options.speakers.map((speaker) => speaker.id)),
    });
  });

/** Keeps only identifiers from the provider failure; its message text may echo the prompt. */
const toProviderError = (error: AiError.AiError): ProviderError => {
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
