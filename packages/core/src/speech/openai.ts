import * as Generated from '@effect/ai-openai/Generated';
import * as OpenAiClient from '@effect/ai-openai/OpenAiClient';
import { Effect, Layer, Stream } from 'effect';
import type { HttpClientError } from 'effect/http';

import { SpeechError, SpeechSynthesizer } from './synthesizer.ts';

export interface OpenAiSpeechOptions {
  /** The TTS model, e.g. `gpt-4o-mini-tts`. */
  readonly model: string;
}

/**
 * A `SpeechSynthesizer` over an OpenAI-compatible `/audio/speech` endpoint, streaming the
 * response body. The application supplies the `OpenAiClient`, and with it the base URL and
 * authentication; build it with `OpenAiClient.make` or `OpenAiClient.layer`, whose client rejects
 * non-2xx responses, so they fail with `SpeechError`.
 */
export const layer = (
  options: OpenAiSpeechOptions,
): Layer.Layer<SpeechSynthesizer, never, OpenAiClient.OpenAiClient> =>
  Layer.effect(
    SpeechSynthesizer,
    Effect.gen(function* () {
      const client = yield* OpenAiClient.OpenAiClient;
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
