import * as Generated from '@effect/ai-openai/Generated';
import * as OpenAiClient from '@effect/ai-openai/OpenAiClient';
import { Effect, Layer, Stream, type Redacted } from 'effect';
import type { HttpClient, HttpClientError } from 'effect/unstable/http';

import { SpeechError, SpeechSynthesizer } from './synthesizer.ts';

export interface OpenAiSpeechOptions {
  /** Base URL of an OpenAI-compatible API, e.g. `https://api.openai.com/v1`. */
  readonly baseUrl?: string;
  readonly apiKey?: Redacted.Redacted<string>;
  /** The TTS model, e.g. `gpt-4o-mini-tts`. */
  readonly model: string;
}

/**
 * A `SpeechSynthesizer` over an OpenAI-compatible `/audio/speech` endpoint, streaming the
 * response body. Non-2xx responses fail with `SpeechError`. The caller supplies the `HttpClient`.
 */
export const layerOpenAi = (
  options: OpenAiSpeechOptions,
): Layer.Layer<SpeechSynthesizer, never, HttpClient.HttpClient> =>
  Layer.effect(
    SpeechSynthesizer,
    Effect.gen(function* () {
      const client = yield* OpenAiClient.make({
        ...(options.baseUrl === undefined ? {} : { apiUrl: options.baseUrl }),
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      });
      const api = Generated.make(client.client);
      return SpeechSynthesizer.of({
        synthesize: (request) =>
          api
            .createSpeechStream({
              payload: {
                model: options.model,
                input: request.text,
                voice: request.voice.name,
                response_format: request.format,
                // Raw audio bytes as they are synthesized. Some compatible servers otherwise
                // return the whole clip only once synthesis finishes.
                stream_format: 'audio',
                ...(request.voice.instructions === undefined
                  ? {}
                  : { instructions: request.voice.instructions }),
              },
            })
            .pipe(Stream.mapError(toSpeechError)),
      });
    }),
  );

const toSpeechError = (error: HttpClientError.HttpClientError): SpeechError => {
  const reason = error.reason;
  const status = 'response' in reason ? reason.response.status : undefined;
  return new SpeechError({ reason: reason._tag, ...(status === undefined ? {} : { status }) });
};
