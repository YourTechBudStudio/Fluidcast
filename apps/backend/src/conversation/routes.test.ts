import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { noSessionStatus, sessionPaths } from '@fluidcast/app-contract';

import { fakeActiveLayer, fakeBuild, startOver, withApp } from './fixtures.test.ts';
import { conversationRoutes } from './routes.ts';

/** The conversation routes over a fake build: real speech-only sessions with an idle fake worker. */
const app = () =>
  HttpRouter.toWebHandler(
    conversationRoutes.pipe(Layer.provideMerge(fakeActiveLayer(fakeBuild().build))),
    { disableLogger: true },
  );

const staleToolCommand = {
  _tag: 'ToolCommand',
  handle: 'call_1',
  executionId: 'gone',
  payload: { rendered: true },
};

describe('POST /api/session/:sessionId/commands', () => {
  it('answers a stale ToolCommand with 409 and a ToolCommandRejected body', async () => {
    await withApp(app(), async (send) => {
      const id = await startOver(send);
      const response = await send(sessionPaths(id).commands, {
        method: 'POST',
        json: staleToolCommand,
      });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        _tag: 'ToolCommandRejected',
        executionId: 'gone',
        reason: 'stale',
      });
    });
  });

  it('answers 404 NoSession for a session that is not the live one', async () => {
    await withApp(app(), async (send) => {
      await startOver(send);
      const response = await send(sessionPaths('other').commands, {
        method: 'POST',
        json: staleToolCommand,
      });
      assert.equal(response.status, noSessionStatus);
      assert.deepEqual(await response.json(), { _tag: 'NoSession' });
    });
  });
});

describe('GET /api/session/:sessionId/events', () => {
  it('answers 404 NoSession for a session that is not the live one', async () => {
    await withApp(app(), async (send) => {
      const before = await send(sessionPaths('none').events);
      assert.equal(before.status, noSessionStatus);
      assert.deepEqual(await before.json(), { _tag: 'NoSession' });
    });
  });

  it('streams the live session, and ends when it is reset', async () => {
    await withApp(app(), async (send) => {
      const id = await startOver(send);
      const response = await send(sessionPaths(id).events);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/event-stream');
      const reset = await send(sessionPaths(id).session, { method: 'DELETE' });
      assert.equal(reset.status, 204);
      // The body ends, so reading it completes.
      const body = await response.text();
      assert.ok(body.startsWith('data: {"_tag":"Snapshot"'));
    });
  });
});
