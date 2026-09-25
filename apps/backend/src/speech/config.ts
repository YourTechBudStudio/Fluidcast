import { Schema } from 'effect';

import { AudioFormat } from '@yourtechbudstudio/fluidcast-core';

/** Text-to-speech. Keyed on `provider`; only `openai` (and OpenAI-compatible servers) exists now. */
export const TtsSection = Schema.Union([
  Schema.Struct({
    provider: Schema.Literal('openai'),
    /** Base URL of the API. Defaults to `llm.baseUrl`. */
    baseUrl: Schema.optionalKey(Schema.NonEmptyString),
    model: Schema.NonEmptyString,
    /** Defaults to `opus`. */
    format: Schema.optionalKey(AudioFormat),
    /**
     * The environment variable holding the key. Defaults to `FLUIDCAST_TTS_API_KEY`; when that
     * variable is unset, the LLM key is used.
     */
    apiKeyEnv: Schema.optionalKey(Schema.NonEmptyString),
  }),
]).annotate({ expected: 'a section with provider: openai (the only provider so far)' });
export type TtsSection = typeof TtsSection.Type;

/** The speech slice's config sections. */
export const SpeechSections = { tts: TtsSection };

export const defaultTtsApiKeyEnv = 'FLUIDCAST_TTS_API_KEY';
