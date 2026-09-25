import type { Layer } from 'effect';
import type { HttpClient } from 'effect/unstable/http';

import type { AudioFormat, SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { layerOpenAi } from '@yourtechbudstudio/fluidcast-core/speech/openai';

import type { Connection } from '../providers.ts';

/** The speech slice's resolved config: defaults applied and the provider's key read. */
export interface SpeechConfig {
  readonly model: string;
  readonly format: AudioFormat;
  readonly connection: Connection;
}

/** Core's OpenAI `SpeechSynthesizer` for the configured connection. */
export const synthesizerLayer = (
  config: SpeechConfig,
): Layer.Layer<SpeechSynthesizer, never, HttpClient.HttpClient> =>
  layerOpenAi({
    model: config.model,
    apiKey: config.connection.apiKey,
    ...(config.connection.baseUrl === undefined ? {} : { baseUrl: config.connection.baseUrl }),
  });
