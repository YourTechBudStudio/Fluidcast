import type { Layer, Redacted } from 'effect';
import type { HttpClient } from 'effect/unstable/http';

import {
  layerOpenAi,
  type AudioFormat,
  type SpeechSynthesizer,
} from '@yourtechbudstudio/fluidcast-core';

/** The speech slice's resolved config: defaults applied and the key read. */
export interface SpeechConfig {
  readonly baseUrl?: string;
  readonly model: string;
  readonly format: AudioFormat;
  readonly apiKey: Redacted.Redacted<string>;
}

/** Core's OpenAI-compatible `SpeechSynthesizer` for the configured endpoint. */
export const synthesizerLayer = (
  config: SpeechConfig,
): Layer.Layer<SpeechSynthesizer, never, HttpClient.HttpClient> =>
  layerOpenAi({
    model: config.model,
    apiKey: config.apiKey,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  });
