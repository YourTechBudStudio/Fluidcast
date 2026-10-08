import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as OpenAiClient from '@effect/ai-openai/OpenAiClient';
import { Effect, Layer, Redacted } from 'effect';
import {
  HttpClient,
  type HttpClientRequest,
  HttpClientRequest as Request,
  HttpClientResponse,
} from 'effect/http';

import { type Connection, openAiClientLayer } from './providers.ts';

/** Sends one request through `openAiClientLayer(connection)` and returns what reached the network. */
const sent = async (connection: Connection) => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const http = HttpClient.make((request) => {
    requests.push(request);
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response('{}')));
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* OpenAiClient.OpenAiClient;
      yield* client.client.execute(Request.get('/models'));
    }).pipe(
      Effect.provide(
        openAiClientLayer(connection).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
        ),
      ),
    ),
  );
  assert.equal(requests.length, 1);
  return requests[0]!;
};

describe('openAiClientLayer', () => {
  it("sends the key as a bearer token to OpenAI's API by default", async () => {
    const request = await sent({ apiKey: Redacted.make('the-key') });
    assert.equal(request.url, 'https://api.openai.com/v1/models');
    assert.equal(request.headers['authorization'], 'Bearer the-key');
  });

  it('sends requests to the configured base URL', async () => {
    const request = await sent({
      apiKey: Redacted.make('the-key'),
      baseUrl: 'http://127.0.0.1:9/v1',
    });
    assert.equal(request.url, 'http://127.0.0.1:9/v1/models');
    assert.equal(request.headers['authorization'], 'Bearer the-key');
  });
});
