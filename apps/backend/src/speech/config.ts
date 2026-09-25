import { Schema } from 'effect';

import { AudioFormat } from '@yourtechbudstudio/fluidcast-core/speech';

/** Text-to-speech. Voices are not here: each speaker carries its own. */
export const TtsSection = Schema.Struct({
  model: Schema.NonEmptyString,
  /** Defaults to `opus`. The Harness, the backend and the client all rely on it. */
  format: Schema.optionalKey(AudioFormat),
  /** `tts.provider`: only `openai` synthesizes speech. It has no options yet. */
  provider: Schema.Struct({ type: Schema.Literal('openai') }),
});
export type TtsSection = typeof TtsSection.Type;

/** The speech slice's config sections. */
export const SpeechSections = { tts: TtsSection };
