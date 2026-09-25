import { Layer } from 'effect';
import type { HttpClient } from 'effect/unstable/http';

import type { AudioFormat, SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core';
import { layer as harnessLayer, type Session } from '@yourtechbudstudio/fluidcast-harness';

import type { SpeakerSection } from './config.ts';
import { languageModelLayer, type LlmConfig } from './language-model.ts';

/** The conversation slice's resolved config. */
export interface ConversationConfig {
  readonly llm: LlmConfig;
  readonly instructions: string;
  readonly speakers: readonly [typeof SpeakerSection.Type, ...Array<typeof SpeakerSection.Type>];
}

/** The single in-memory Harness session, generating with the configured language model. */
export const sessionLayer = (
  config: ConversationConfig,
  speechFormat: AudioFormat,
): Layer.Layer<Session, never, SpeechSynthesizer | HttpClient.HttpClient> =>
  harnessLayer({
    instructions: config.instructions,
    speakers: config.speakers,
    speechFormat,
  }).pipe(Layer.provide(languageModelLayer(config.llm)));
