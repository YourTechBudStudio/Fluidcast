import { Effect, Exit, Layer, Stream } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http';
import { describe, expect, it } from 'vitest';

import { TransportError } from '@yourtechbudstudio/fluidcast-client';

import { resetSession, startSession, watchSessionStatus } from './session';

/** An `HttpClient` that answers every request with `respond`'s canned response, recording what it was asked. */
const fakeClient = (respond: () => Response) => {
  const requests: Array<{
    readonly method: string;
    readonly url: string;
    readonly body?: unknown;
  }> = [];
  const client = HttpClient.make((request, url) => {
    const body =
      request.body._tag === 'Uint8Array'
        ? { body: JSON.parse(new TextDecoder().decode(request.body.body)) as unknown }
        : {};
    requests.push({ method: request.method, url: url.pathname, ...body });
    return Effect.succeed(HttpClientResponse.fromWeb(request, respond()));
  }).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl('http://backend.test')));
  return { requests, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const sse = (...frames: readonly unknown[]) =>
  new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

describe('watchSessionStatus', () => {
  it('decodes each status frame in order', async () => {
    const fake = fakeClient(() =>
      sse({ _tag: 'NoSession' }, { _tag: 'Active', id: 'a' }, { _tag: 'NoSession' }),
    );
    const statuses = await Effect.runPromise(
      Stream.runCollect(watchSessionStatus()).pipe(Effect.provide(fake.layer)),
    );
    expect(statuses).toEqual([
      { _tag: 'NoSession' },
      { _tag: 'Active', id: 'a' },
      { _tag: 'NoSession' },
    ]);
    expect(fake.requests).toEqual([{ method: 'GET', url: '/api/session' }]);
  });
});

describe('startSession', () => {
  it('posts the mode and the chosen agent, and the pasted ID for Continue', async () => {
    const fake = fakeClient(() => new Response(null, { status: 204 }));
    await Effect.runPromise(
      Effect.all([
        startSession({ mode: 'new', agent: 'codex' }),
        startSession({ mode: 'continue', agent: 'claude', sessionId: ' id ' }),
      ]).pipe(Effect.provide(fake.layer)),
    );
    expect(fake.requests).toEqual([
      { method: 'POST', url: '/api/session', body: { mode: 'new', agent: 'codex' } },
      {
        method: 'POST',
        url: '/api/session',
        body: { mode: 'continue', agent: 'claude', sessionId: ' id ' },
      },
    ]);
  });
});

describe('resetSession', () => {
  const reset = (status: number) => {
    const fake = fakeClient(() => new Response(null, { status }));
    return Effect.runPromiseExit(resetSession('a/b').pipe(Effect.provide(fake.layer))).then(
      (exit) => ({ exit, requests: fake.requests }),
    );
  };

  it("deletes the session's own path, and succeeds on 204", async () => {
    const { exit, requests } = await reset(204);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests).toEqual([{ method: 'DELETE', url: '/api/session/a%2Fb' }]);
  });

  it('succeeds on 404: the session is gone either way', async () => {
    expect(Exit.isSuccess((await reset(404)).exit)).toBe(true);
  });

  it('fails with a ServerError on 500', async () => {
    const { exit } = await reset(500);
    expect(exit).toEqual(Exit.fail(new TransportError({ reason: 'ServerError', status: 500 })));
  });
});
