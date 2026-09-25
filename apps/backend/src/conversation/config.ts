import { Schema } from 'effect';

/** The chat model. Keyed on `provider`; only `openai` (and OpenAI-compatible servers) exists now. */
export const LlmSection = Schema.Union([
  Schema.Struct({
    provider: Schema.Literal('openai'),
    /** `chat-completions` for any OpenAI-compatible server; `responses` for OpenAI's Responses API. */
    api: Schema.Literals(['chat-completions', 'responses']),
    /** Base URL of the API, e.g. `https://api.openai.com/v1`. Defaults to OpenAI's. */
    baseUrl: Schema.optionalKey(Schema.NonEmptyString),
    model: Schema.NonEmptyString,
    /** The environment variable holding the key. Defaults to `FLUIDCAST_LLM_API_KEY`. */
    apiKeyEnv: Schema.optionalKey(Schema.NonEmptyString),
  }),
]).annotate({ expected: 'a section with provider: openai (the only provider so far)' });
export type LlmSection = typeof LlmSection.Type;

export const SpeakerSection = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  personality: Schema.String,
  /** The TTS provider's voice. */
  voice: Schema.NonEmptyString,
  /** Optional delivery guidance for TTS providers that support it. */
  voiceInstructions: Schema.optionalKey(Schema.String),
});

/** The conversation slice's config sections. The first speaker is the lead. */
export const ConversationSections = {
  llm: LlmSection,
  instructions: Schema.optionalKey(Schema.String),
  speakers: Schema.NonEmptyArray(SpeakerSection).check(
    Schema.makeFilter(
      (speakers) => new Set(speakers.map(({ id }) => id)).size === speakers.length,
      { expected: 'speakers with unique ids' },
    ),
  ),
};

export const defaultLlmApiKeyEnv = 'FLUIDCAST_LLM_API_KEY';
