import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import {
  type HttpBody,
  HttpClient,
  type HttpClientRequest,
  HttpClientResponse,
} from 'effect/unstable/http';

import * as OAuth from './oauth.ts';

const now = 1_700_000_000_000;
const scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

/** A token endpoint answering every request with `body` and `status`, recording each request. */
const tokenEndpoint = (body: unknown, status = 200) => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const client = HttpClient.make((request) => {
    requests.push(request);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });
  return { requests, client };
};

/** The form fields of a recorded token request. */
const form = (request: HttpClientRequest.HttpClientRequest) =>
  Object.fromEntries(
    new URLSearchParams(new TextDecoder().decode((request.body as HttpBody.Uint8Array).body)),
  );

/** Runs `effect` against `endpoint` at the test time `now`. */
const run = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  endpoint: ReturnType<typeof tokenEndpoint>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(now);
      return yield* Effect.result(effect);
    }).pipe(
      Effect.provideService(HttpClient.HttpClient, endpoint.client),
      Effect.provide(TestClock.layer()),
    ),
  );

const idToken = (claims: object) =>
  ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.');

const callback = (parameters: Record<string, string>) =>
  new URL(`http://127.0.0.1:1455/auth/callback?${new URLSearchParams(parameters).toString()}`);

describe('authorizationUrl', () => {
  it('carries every parameter the sign-in needs', () => {
    const url = new URL(
      OAuth.authorizationUrl({
        hostId: 'ABCDEF01-2345-6789-ABCD-EF0123456789',
        state: 'the-state',
        nonce: 'the-nonce',
        challenge: OAuth.codeChallenge('the-verifier'),
      }),
    );
    assert.equal(url.origin + url.pathname, 'https://auth.openai.com/api/accounts/authorize');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      client_id: 'dynamic_agent_client',
      agent_name_hint: 'Fluidcast',
      ext_agent_host_id: 'urn:uuid:abcdef01-2345-6789-abcd-ef0123456789',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      resource: 'https://api.openai.com/v1',
      scope,
      state: 'the-state',
      code_challenge: OAuth.codeChallenge('the-verifier'),
      code_challenge_method: 'S256',
      nonce: 'the-nonce',
    });
  });

  it('derives the S256 challenge from the verifier', () => {
    // RFC 7636, appendix B.
    assert.equal(
      OAuth.codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('parseCallback', () => {
  const parse = (parameters: Record<string, string>) =>
    Effect.runSync(Effect.result(OAuth.parseCallback(callback(parameters), 'the-state')));

  it('returns the code and the issued client ID', () => {
    const result = parse({ state: 'the-state', code: 'the-code', client_id: 'issued' });
    assert.equal(result._tag, 'Success');
    assert.deepEqual(result.success, { code: 'the-code', clientId: 'issued' });
  });

  it('rejects a callback for another sign-in, even an error one', () => {
    for (const parameters of [
      { state: 'other', code: 'the-code', client_id: 'issued' },
      { state: 'other', error: 'access_denied' },
    ]) {
      const result = parse(parameters);
      assert.equal(result._tag, 'Failure');
      assert.equal(result.failure.reason, 'Failed');
      assert.match(result.failure.message, /state/);
    }
  });

  it('rejects a callback without a code or a client ID', () => {
    const noCode = parse({ state: 'the-state', client_id: 'issued' });
    assert.equal(noCode._tag, 'Failure');
    assert.match(noCode.failure.message, /authorization code/);
    const noClient = parse({ state: 'the-state', code: 'the-code' });
    assert.equal(noClient._tag, 'Failure');
    assert.match(noClient.failure.message, /client ID/);
  });

  it("reports OpenAI's error callback as rejected", () => {
    const result = parse({ state: 'the-state', error: 'access_denied' });
    assert.equal(result._tag, 'Failure');
    assert.equal(result.failure.reason, 'Rejected');
    assert.match(result.failure.message, /access_denied/);
  });
});

describe('exchangeCode', () => {
  it('sends the documented form and returns the tokens, expiry and email', async () => {
    const endpoint = tokenEndpoint({
      access_token: 'access',
      refresh_token: 'refresh',
      id_token: idToken({ email: 'someone@example.com' }),
      expires_in: 3600,
      scope,
    });
    const result = await run(
      OAuth.exchangeCode({ code: 'the-code', verifier: 'the-verifier', clientId: 'issued' }),
      endpoint,
    );
    assert.equal(result._tag, 'Success');
    assert.deepEqual(result.success, {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: now + 3600 * 1000,
      email: 'someone@example.com',
    });

    const [request] = endpoint.requests;
    assert.equal(request!.method, 'POST');
    assert.equal(request!.url, 'https://auth.openai.com/api/accounts/oauth/token');
    assert.deepEqual(form(request!), {
      grant_type: 'authorization_code',
      client_id: 'issued',
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      resource: 'https://api.openai.com/v1',
    });
  });

  it('leaves out the email when the ID token has none', async () => {
    const endpoint = tokenEndpoint({
      access_token: 'access',
      refresh_token: 'refresh',
      id_token: idToken({ sub: 'user' }),
      expires_in: 3600,
      scope,
    });
    const result = await run(
      OAuth.exchangeCode({ code: 'c', verifier: 'v', clientId: 'issued' }),
      endpoint,
    );
    assert.equal(result._tag, 'Success');
    assert.equal('email' in result.success, false);
  });

  it('rejects a token without the chatgpt.tokens.use.direct scope', async () => {
    const endpoint = tokenEndpoint({
      access_token: 'access',
      refresh_token: 'refresh',
      id_token: idToken({}),
      expires_in: 3600,
      scope: 'openid profile email offline_access',
    });
    const result = await run(
      OAuth.exchangeCode({ code: 'c', verifier: 'v', clientId: 'issued' }),
      endpoint,
    );
    assert.equal(result._tag, 'Failure');
    assert.equal(result.failure.reason, 'Failed');
    assert.match(result.failure.message, /chatgpt\.tokens\.use\.direct/);
  });
});

describe('refresh', () => {
  it('sends the documented form and returns the rotated tokens', async () => {
    const endpoint = tokenEndpoint({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      expires_in: 600,
      scope,
    });
    const result = await run(
      OAuth.refresh({ clientId: 'issued', refreshToken: 'refresh' }),
      endpoint,
    );
    assert.equal(result._tag, 'Success');
    assert.deepEqual(result.success, {
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: now + 600 * 1000,
    });
    assert.deepEqual(form(endpoint.requests[0]!), {
      grant_type: 'refresh_token',
      client_id: 'issued',
      refresh_token: 'refresh',
      resource: 'https://api.openai.com/v1',
    });
  });

  it('returns no refresh token when OpenAI keeps the old one', async () => {
    const endpoint = tokenEndpoint({ access_token: 'access-2', expires_in: 600, scope });
    const result = await run(
      OAuth.refresh({ clientId: 'issued', refreshToken: 'refresh' }),
      endpoint,
    );
    assert.equal(result._tag, 'Success');
    assert.equal('refreshToken' in result.success, false);
  });

  it("reports OpenAI's refusal as rejected, with its error code and without tokens", async () => {
    const endpoint = tokenEndpoint({ error: 'invalid_grant' }, 400);
    const result = await run(
      OAuth.refresh({ clientId: 'issued', refreshToken: 'secret-refresh-token' }),
      endpoint,
    );
    assert.equal(result._tag, 'Failure');
    assert.equal(result.failure.reason, 'Rejected');
    assert.match(result.failure.message, /invalid_grant/);
    assert.doesNotMatch(String(result.failure), /secret-refresh-token/);
  });

  it('reports a server failure as failed', async () => {
    const endpoint = tokenEndpoint({ error: 'server_error' }, 500);
    const result = await run(
      OAuth.refresh({ clientId: 'issued', refreshToken: 'refresh' }),
      endpoint,
    );
    assert.equal(result._tag, 'Failure');
    assert.equal(result.failure.reason, 'Failed');
  });
});
