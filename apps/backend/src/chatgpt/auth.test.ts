import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Deferred, Effect, Fiber, FileSystem, Layer, Redacted } from 'effect';
import { HttpClient, type HttpClientRequest, HttpClientResponse } from 'effect/unstable/http';

import { ChatGptAuth } from './auth.ts';
import type { ChatGptCredentials } from './credentials.ts';

const scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const hour = 60 * 60 * 1000;

const directories: Array<string> = [];
after(() => directories.forEach((directory) => rmSync(directory, { recursive: true })));

/** A credential file in a fresh directory, expiring `expiresIn` milliseconds from now. */
const credentialFile = (expiresIn: number) => {
  const directory = mkdtempSync(join(tmpdir(), 'fluidcast-auth-'));
  directories.push(directory);
  const path = join(directory, 'chatgpt-auth.json');
  save(path, {
    hostId: 'host',
    clientId: 'issued',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + expiresIn,
  });
  return path;
};

const save = (path: string, credentials: ChatGptCredentials) =>
  writeFileSync(path, JSON.stringify(credentials), { mode: 0o600 });

const saved = (path: string): ChatGptCredentials => JSON.parse(readFileSync(path, 'utf8'));

/**
 * A token endpoint answering each refresh with `reply`, recording every request. Each reply waits
 * for `gate` when one is given.
 */
const tokenEndpoint = (
  reply: () => { readonly status: number; readonly body: object },
  gate?: Deferred.Deferred<void>,
) => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      requests.push(request);
      if (gate !== undefined) yield* Deferred.await(gate);
      const { status, body } = reply();
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return { requests, client };
};

const rotated = () => ({
  status: 200,
  body: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600, scope },
});

/** Node's file system, with `onRead` run after every read of a file's text. */
const watchedFileSystem = (onRead: (path: string) => void) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) =>
      FileSystem.FileSystem.of({
        ...fs,
        readFileString: (path, encoding) =>
          fs.readFileString(path, encoding).pipe(Effect.tap(() => Effect.sync(() => onRead(path)))),
      }),
    ),
  ).pipe(Layer.provide(NodeServices.layer));

/** Runs `use` with a `ChatGptAuth` over `path`, the token endpoint and `fileSystem`. */
const withAuth = <A, E>(
  path: string,
  endpoint: ReturnType<typeof tokenEndpoint>,
  use: (auth: ChatGptAuth['Service']) => Effect.Effect<A, E>,
  fileSystem: Layer.Layer<FileSystem.FileSystem> = NodeServices.layer,
) =>
  Effect.runPromise(
    Effect.flatMap(ChatGptAuth, use).pipe(
      Effect.provide(ChatGptAuth.layer(path)),
      Effect.provideService(HttpClient.HttpClient, endpoint.client),
      Effect.provide(fileSystem),
    ),
  );

/** Polls `done` until it holds. */
const waitUntil = (done: () => boolean): Effect.Effect<void> =>
  done()
    ? Effect.void
    : Effect.sleep('5 millis').pipe(Effect.andThen(Effect.suspend(() => waitUntil(done))));

const token = (auth: ChatGptAuth['Service']) =>
  auth.accessToken.pipe(Effect.map(Redacted.value), Effect.result);

describe('ChatGptAuth', () => {
  it('returns a fresh token without calling the token endpoint', async () => {
    const path = credentialFile(hour);
    const endpoint = tokenEndpoint(rotated);
    const result = await withAuth(path, endpoint, token);
    assert.equal(result._tag, 'Success');
    assert.equal(result.success, 'access-1');
    assert.equal(endpoint.requests.length, 0);
  });

  it('refreshes an expiring token and writes it back, keeping the rest', async () => {
    const path = credentialFile(60 * 1000);
    const endpoint = tokenEndpoint(rotated);
    const result = await withAuth(path, endpoint, token);
    assert.equal(result._tag, 'Success');
    assert.equal(result.success, 'access-2');
    assert.equal(endpoint.requests.length, 1);
    const file = saved(path);
    assert.equal(file.accessToken, 'access-2');
    assert.equal(file.refreshToken, 'refresh-2');
    assert.ok(file.expiresAt > Date.now() + 50 * 60 * 1000);
    assert.equal(file.hostId, 'host');
    assert.equal(file.clientId, 'issued');
  });

  it('keeps the old refresh token when OpenAI returns none', async () => {
    const path = credentialFile(60 * 1000);
    const endpoint = tokenEndpoint(() => ({
      status: 200,
      body: { access_token: 'access-2', expires_in: 3600, scope },
    }));
    const result = await withAuth(path, endpoint, token);
    assert.equal(result._tag, 'Success');
    assert.equal(saved(path).refreshToken, 'refresh-1');
  });

  it('refreshes once for concurrent requests on an expiring token', async () => {
    const path = credentialFile(60 * 1000);
    const callers = 5;
    let reads = 0;
    const gate = Deferred.makeUnsafe<void>();
    const endpoint = tokenEndpoint(rotated, gate);
    const results = await withAuth(
      path,
      endpoint,
      (auth) =>
        Effect.gen(function* () {
          const fibers = yield* Effect.forEach(Array.from({ length: callers }), () =>
            Effect.forkChild(token(auth)),
          );
          // Every caller has seen the expiring token, and the first refresh re-read it and is
          // waiting on the token endpoint: only then may the refresh finish.
          yield* waitUntil(() => reads >= callers + 1 && endpoint.requests.length > 0);
          yield* Deferred.succeed(gate, undefined);
          return yield* Fiber.joinAll(fibers);
        }),
      watchedFileSystem(() => reads++),
    );
    assert.equal(endpoint.requests.length, 1);
    assert.deepEqual(
      results.map((result) => (result._tag === 'Success' ? result.success : result._tag)),
      Array.from({ length: callers }, () => 'access-2'),
    );
  });

  it('does not refresh when the file became fresh before the refresh (a re-login)', async () => {
    const path = credentialFile(60 * 1000);
    let reads = 0;
    const endpoint = tokenEndpoint(rotated);
    const result = await withAuth(
      path,
      endpoint,
      token,
      // Right after the first read saw the expiring token, a re-login replaces the file.
      watchedFileSystem(() => {
        if (++reads === 1) {
          save(path, {
            ...saved(path),
            accessToken: 'access-relogin',
            refreshToken: 'refresh-relogin',
            expiresAt: Date.now() + hour,
          });
        }
      }),
    );
    assert.equal(result._tag, 'Success');
    assert.equal(result.success, 'access-relogin');
    assert.equal(endpoint.requests.length, 0);
    assert.equal(saved(path).refreshToken, 'refresh-relogin');
  });

  it('reports SignInExpired when OpenAI rejects the refresh, leaving the file alone', async () => {
    const path = credentialFile(60 * 1000);
    const before = readFileSync(path, 'utf8');
    const endpoint = tokenEndpoint(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    const result = await withAuth(path, endpoint, (auth) => Effect.result(auth.accessToken));
    assert.equal(result._tag, 'Failure');
    assert.equal(result.failure.reason, 'SignInExpired');
    assert.doesNotMatch(String(result.failure), /access-1|refresh-1/);
    assert.equal(readFileSync(path, 'utf8'), before);
  });

  it('reports RefreshFailed when the token endpoint fails', async () => {
    const path = credentialFile(60 * 1000);
    const endpoint = tokenEndpoint(() => ({ status: 503, body: { error: 'unavailable' } }));
    const result = await withAuth(path, endpoint, (auth) => Effect.result(auth.accessToken));
    assert.equal(result._tag, 'Failure');
    assert.equal(result.failure.reason, 'RefreshFailed');
  });

  it('reports NotSignedIn when the file is missing', async () => {
    const path = credentialFile(hour);
    rmSync(path);
    const endpoint = tokenEndpoint(rotated);
    const result = await withAuth(path, endpoint, (auth) => Effect.result(auth.accessToken));
    assert.equal(result._tag, 'Failure');
    assert.equal(result.failure.reason, 'NotSignedIn');
    assert.equal(endpoint.requests.length, 0);
  });
});
