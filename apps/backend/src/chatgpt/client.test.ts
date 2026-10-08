import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import * as OpenAiClient from '@effect/ai-openai/OpenAiClient';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Layer } from 'effect';
import {
  HttpClient,
  type HttpClientRequest,
  HttpClientRequest as Request,
  HttpClientResponse,
} from 'effect/http';

import { chatGptClientLayer } from './client.ts';

const directories: Array<string> = [];
after(() => directories.forEach((directory) => rmSync(directory, { recursive: true })));

/** A credential file expiring `expiresIn` milliseconds from now; `undefined` writes none. */
const credentialFile = (expiresIn: number | undefined) => {
  const directory = mkdtempSync(join(tmpdir(), 'fluidcast-client-'));
  directories.push(directory);
  const path = join(directory, 'chatgpt-auth.json');
  if (expiresIn !== undefined) {
    writeFileSync(
      path,
      JSON.stringify({
        hostId: 'host',
        clientId: 'issued',
        accessToken: 'secret-access-token',
        refreshToken: 'secret-refresh-token',
        expiresAt: Date.now() + expiresIn,
      }),
    );
  }
  return path;
};

/**
 * Sends one request through `chatGptClientLayer(path)`. The fake network answers OpenAI's API with
 * `{}` and the token endpoint with `400 invalid_grant`, and records every request.
 */
const send = async (path: string) => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const http = HttpClient.make((request) => {
    requests.push(request);
    const tokenEndpoint = request.url.startsWith('https://auth.openai.com/');
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        tokenEndpoint
          ? new Response('{"error":"invalid_grant"}', {
              status: 400,
              headers: { 'content-type': 'application/json' },
            })
          : new Response('{}'),
      ),
    );
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* OpenAiClient.OpenAiClient;
      return yield* client.client.execute(Request.get('/models'));
    }).pipe(
      Effect.result,
      Effect.provide(
        chatGptClientLayer(path).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
          Layer.provide(NodeServices.layer),
        ),
      ),
    ),
  );
  return { result, requests };
};

describe('chatGptClientLayer', () => {
  it("sends the current access token as a bearer token to OpenAI's API", async () => {
    const { result, requests } = await send(credentialFile(60 * 60 * 1000));
    assert.equal(result._tag, 'Success');
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, 'https://api.openai.com/v1/models');
    assert.equal(requests[0]!.headers['authorization'], 'Bearer secret-access-token');
  });

  it('fails the request as a transport error when not signed in, without calling the API', async () => {
    const { result, requests } = await send(credentialFile(undefined));
    assert.equal(result._tag, 'Failure');
    assert.equal(result.failure._tag, 'HttpClientError');
    assert.equal(result.failure.reason._tag, 'TransportError');
    assert.match(String(result.failure.reason.description), /NotSignedIn/);
    assert.equal(requests.length, 0);
  });

  it('fails the request without any token text when the refresh is rejected', async () => {
    const { result, requests } = await send(credentialFile(60 * 1000));
    assert.equal(result._tag, 'Failure');
    assert.equal(result.failure._tag, 'HttpClientError');
    assert.equal(result.failure.reason._tag, 'TransportError');
    assert.match(String(result.failure.reason.description), /SignInExpired/);
    // Only the token endpoint was called; the API never was.
    assert.deepEqual(
      requests.map((request) => new URL(request.url).host),
      ['auth.openai.com'],
    );
    const text = `${String(result.failure)} ${JSON.stringify(result.failure)}`;
    assert.doesNotMatch(text, /secret-access-token|secret-refresh-token/);
  });
});
