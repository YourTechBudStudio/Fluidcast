import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as AnthropicClient from '@effect/ai-anthropic/AnthropicClient';
import * as OpenAiClient from '@effect/ai-openai/OpenAiClient';
import { Effect, Layer, Redacted } from 'effect';
import {
  HttpClient,
  type HttpClientRequest,
  HttpClientRequest as Request,
  HttpClientResponse,
} from 'effect/http';

import {
  anthropicClientLayer,
  appendAnthropicBeta,
  type Connection,
  openAiClientLayer,
} from './providers.ts';

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

/**
 * Starts one streamed message through `anthropicClientLayer`, with `beta` as the library's own
 * per-request betas, and returns what reached the network.
 */
const sentToAnthropic = async (
  connection: Connection,
  options: { readonly fastMode: boolean; readonly beta?: string },
) => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const http = HttpClient.make((request) => {
    requests.push(request);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response('', { headers: { 'content-type': 'text/event-stream' } }),
      ),
    );
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* AnthropicClient.AnthropicClient;
      yield* client.createMessageStream({
        payload: { model: 'm', max_tokens: 1, messages: [] },
        ...(options.beta === undefined ? {} : { params: { 'anthropic-beta': options.beta } }),
      });
    }).pipe(
      Effect.provide(
        anthropicClientLayer(connection, { fastMode: options.fastMode }).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
        ),
      ),
    ),
  );
  assert.equal(requests.length, 1);
  return requests[0]!;
};

describe('anthropicClientLayer', () => {
  it("sends the key and API version to Anthropic's API by default", async () => {
    const request = await sentToAnthropic(
      { apiKey: Redacted.make('the-key') },
      { fastMode: false },
    );
    assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(request.headers['x-api-key'], 'the-key');
    assert.equal(request.headers['anthropic-version'], '2023-06-01');
    assert.equal(request.headers['anthropic-beta'], undefined);
  });

  it('sends requests to the configured base URL', async () => {
    const request = await sentToAnthropic(
      { apiKey: Redacted.make('the-key'), baseUrl: 'http://127.0.0.1:9' },
      { fastMode: false },
    );
    assert.equal(request.url, 'http://127.0.0.1:9/v1/messages');
    assert.equal(request.headers['x-api-key'], 'the-key');
    assert.equal(request.headers['anthropic-version'], '2023-06-01');
  });

  it("leaves the library's betas unchanged without fast mode", async () => {
    const request = await sentToAnthropic(
      { apiKey: Redacted.make('k') },
      { fastMode: false, beta: 'pdfs-2024-09-25' },
    );
    assert.equal(request.headers['anthropic-beta'], 'pdfs-2024-09-25');
  });

  it("appends the fast-mode beta to the library's betas in fast mode", async () => {
    const request = await sentToAnthropic(
      { apiKey: Redacted.make('k') },
      { fastMode: true, beta: 'pdfs-2024-09-25' },
    );
    assert.equal(request.headers['anthropic-beta'], 'pdfs-2024-09-25,fast-mode-2026-02-01');
  });
});

describe('appendAnthropicBeta', () => {
  const beta = (request: HttpClientRequest.HttpClientRequest) =>
    appendAnthropicBeta(request).headers['anthropic-beta'];

  it('sets the fast-mode beta when the request has none', () => {
    assert.equal(beta(Request.post('/v1/messages')), 'fast-mode-2026-02-01');
  });

  it('appends it to existing betas', () => {
    const request = Request.post('/v1/messages').pipe(
      Request.setHeader('anthropic-beta', 'a-1, b-2'),
    );
    assert.equal(beta(request), 'a-1,b-2,fast-mode-2026-02-01');
  });

  it('does not add it twice', () => {
    const request = Request.post('/v1/messages').pipe(
      Request.setHeader('anthropic-beta', 'fast-mode-2026-02-01,a-1'),
    );
    assert.equal(beta(request), 'fast-mode-2026-02-01,a-1');
  });
});
