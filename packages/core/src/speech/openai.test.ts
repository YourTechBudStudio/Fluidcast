import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as OpenAiClient from '@effect/ai-openai/OpenAiClient';
import { Effect, Layer, Redacted, Stream } from 'effect';
import {
  type HttpBody,
  HttpClient,
  type HttpClientRequest,
  HttpClientResponse,
} from 'effect/unstable/http';

import * as OpenAiSpeech from './openai.ts';
import { synthesize } from './synthesizer.ts';

/** An `HttpClient` answering every request with `reply`, recording each request. */
const fakeHttp = (reply: () => Response) => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const client = HttpClient.make((request) => {
    requests.push(request);
    return Effect.succeed(HttpClientResponse.fromWeb(request, reply()));
  });
  return { requests, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const jsonBody = (request: HttpClientRequest.HttpClientRequest): unknown =>
  JSON.parse(new TextDecoder().decode((request.body as HttpBody.Uint8Array).body));

/** Synthesizes one line through `OpenAiSpeech.layer` over a client the test authenticates. */
const run = (http: ReturnType<typeof fakeHttp>) =>
  Effect.runPromise(
    synthesize({
      text: 'Hello.',
      voice: { name: 'alloy', instructions: 'Calm.' },
      format: 'mp3',
    }).pipe(
      Stream.runCollect,
      Effect.map((chunks) => Buffer.concat(chunks).toString('utf8')),
      Effect.result,
      Effect.provide(
        OpenAiSpeech.layer({ model: 'tts-model' }).pipe(
          Layer.provide(
            OpenAiClient.layer({
              apiKey: Redacted.make('test-key'),
              apiUrl: 'http://speech.test/v1',
            }),
          ),
          Layer.provide(http.layer),
        ),
      ),
    ),
  );

describe('OpenAiSpeech.layer', () => {
  it('posts the line to /audio/speech through the supplied client and streams the body', async () => {
    const http = fakeHttp(() => new Response('audio-bytes', { status: 200 }));
    const result = await run(http);
    assert.equal(result._tag, 'Success');
    assert.equal(result.success, 'audio-bytes');

    assert.equal(http.requests.length, 1);
    const [request] = http.requests;
    assert.equal(request!.method, 'POST');
    assert.equal(request!.url, 'http://speech.test/v1/audio/speech');
    // Authentication is the client's: Core passes none of its own.
    assert.equal(request!.headers['authorization'], 'Bearer test-key');
    assert.deepEqual(jsonBody(request!), {
      model: 'tts-model',
      input: 'Hello.',
      voice: 'alloy',
      response_format: 'mp3',
      stream_format: 'audio',
      instructions: 'Calm.',
    });
  });

  it('fails with SpeechError carrying the status for a non-2xx response', async () => {
    const http = fakeHttp(() => new Response('{"error":"nope"}', { status: 429 }));
    const result = await run(http);
    assert.equal(result._tag, 'Failure');
    assert.equal(result.failure._tag, 'SpeechError');
    assert.equal(result.failure.status, 429);
    assert.equal(result.failure.reason, 'StatusCodeError');
  });
});
