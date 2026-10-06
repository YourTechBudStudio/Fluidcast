import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect, Exit, Fiber, Stream } from 'effect';

import { fakeServer } from './frames.test.ts';
import { RpcClosed, RpcFailure, declineReply, isNotSteerable, makeRpc } from './rpc.ts';

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(Effect.scoped(effect));

const flush = Effect.gen(function* () {
  for (let round = 0; round < 50; round++) yield* Effect.yieldNow;
});

describe('makeRpc', () => {
  it('answers every server request at once with a decline, cancel or error', () =>
    run(
      Effect.gen(function* () {
        const server = yield* fakeServer(() => undefined);
        yield* makeRpc(yield* server.open);
        const methods = [
          'item/commandExecution/requestApproval',
          'item/fileChange/requestApproval',
          'item/tool/requestUserInput',
          'mcpServer/elicitation/request',
          'item/permissions/requestApproval',
          'item/tool/call',
          'account/chatgptAuthTokens/refresh',
          'attestation/generate',
          'applyPatchApproval',
          'execCommandApproval',
          'some/futureRequest',
        ];
        for (const [index, method] of methods.entries()) {
          yield* server.push({ id: `server-${index}`, method, params: {} });
        }
        yield* flush;
        assert.deepEqual(
          server.written.map((message) => message['id']),
          methods.map((_, index) => `server-${index}`),
        );
        assert.deepEqual(server.written[0], { id: 'server-0', result: { decision: 'decline' } });
        assert.deepEqual(server.written[1], { id: 'server-1', result: { decision: 'decline' } });
        assert.deepEqual(server.written[2], { id: 'server-2', result: { answers: {} } });
        assert.deepEqual(server.written[3], {
          id: 'server-3',
          result: { action: 'decline', content: null, ['_meta']: null },
        });
        const field = (index: number, key: string) =>
          (server.written[index] ?? {})[key] as Readonly<Record<string, unknown>>;
        for (const index of [4, 6, 7, 10]) assert.equal(field(index, 'error')['code'], -32603);
        assert.equal(field(5, 'result')['success'], false);
        assert.deepEqual(Object.keys(field(8, 'result')['decision'] as object), ['denied']);
        for (const method of methods) assert.ok(declineReply(method));
      }),
    ));

  it('matches replies to requests, passes notifications on, and fails pending requests at the end', () =>
    run(
      Effect.gen(function* () {
        const server = yield* fakeServer(({ method }) =>
          method === 'ok'
            ? { result: { fine: true } }
            : method === 'bad'
              ? { error: { code: -32600, message: 'no', data: { x: 1 } } }
              : undefined,
        );
        const rpc = yield* makeRpc(yield* server.open);
        assert.deepEqual(yield* rpc.request('ok', {}), { fine: true });
        assert.deepEqual(
          yield* Effect.flip(rpc.request('bad', {})),
          new RpcFailure({ method: 'bad', code: -32600, data: { x: 1 } }),
        );
        const pending = yield* Effect.forkChild(rpc.request('never', {}));
        yield* server.push({ method: 'turn/started', params: { threadId: 't' } });
        yield* server.push('not an object');
        yield* flush;
        yield* server.end;
        assert.deepEqual(yield* Fiber.await(pending), Exit.fail(new RpcClosed()));
        assert.deepEqual(yield* Stream.runCollect(rpc.notifications), [
          { method: 'turn/started', params: { threadId: 't' } },
        ]);
        assert.deepEqual(yield* Effect.flip(rpc.request('ok', {})), new RpcClosed());
      }),
    ));
});

describe('isNotSteerable', () => {
  it('recognises activeTurnNotSteerable in the error data, leniently', () => {
    const failure = (data: unknown) => new RpcFailure({ method: 'turn/start', code: -32600, data });
    assert.equal(
      isNotSteerable(
        failure({ codexErrorInfo: { activeTurnNotSteerable: { turnKind: 'review' } } }),
      ),
      true,
    );
    assert.equal(
      isNotSteerable(
        failure({ error: { codexErrorInfo: { activeTurnNotSteerable: { turnKind: 'compact' } } } }),
      ),
      true,
    );
    assert.equal(isNotSteerable(failure({ codexErrorInfo: 'other' })), false);
    assert.equal(isNotSteerable(failure(undefined)), false);
    assert.equal(isNotSteerable(new RpcClosed()), false);
  });
});
