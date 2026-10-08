import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Layer } from 'effect';
import { HttpRouter } from 'effect/http';

import { resetStatus, routes, sessionPaths, startStatus } from '@fluidcast/app-contract';

import { activeSessionLayer } from './active.ts';
import {
  conversationConfig,
  fakeActiveLayer,
  fakeBuild,
  fakeSources,
  startOver,
  statusOver,
  unusedProviders,
  withApp,
} from './fixtures.test.ts';
import { sessionRoutes } from './session-routes.ts';

/** The lifecycle routes over a fake build. */
const app = () =>
  HttpRouter.toWebHandler(
    sessionRoutes.pipe(Layer.provideMerge(fakeActiveLayer(fakeBuild().build))),
    { disableLogger: true },
  );

describe('GET /api/session', () => {
  it('streams NoSession first, and Active once a session starts', async () => {
    await withApp(app(), async (send) => {
      assert.deepEqual(await statusOver(send), { _tag: 'NoSession' });
      const id = await startOver(send);
      assert.deepEqual(await statusOver(send), { _tag: 'Active', id });
    });
  });
});

describe('POST /api/session', () => {
  it('answers an invalid body with 400 InvalidRequest', async () => {
    await withApp(app(), async (send) => {
      const invalid = [
        { mode: 'resume', agent: 'claude' },
        { mode: 'continue', agent: 'claude' },
        // The agent is required: no default, no detection.
        { mode: 'new' },
        { mode: 'new', agent: 'gemini' },
        'new',
      ];
      for (const json of invalid) {
        const response = await send(routes.session, { method: 'POST', json });
        assert.equal(response.status, startStatus.invalid);
        assert.deepEqual(await response.json(), { _tag: 'InvalidRequest' });
      }
      assert.deepEqual(await statusOver(send), { _tag: 'NoSession' });
    });
  });

  it('answers 409 SessionActive while a session is live', async () => {
    await withApp(app(), async (send) => {
      const id = await startOver(send);
      const response = await send(routes.session, {
        method: 'POST',
        json: { mode: 'new', agent: 'codex' },
      });
      assert.equal(response.status, startStatus.active);
      assert.deepEqual(await response.json(), { _tag: 'SessionActive' });
      assert.deepEqual(await statusOver(send), { _tag: 'Active', id });
    });
  });

  it('answers a Continue of a non-UUID with 422 InvalidSessionId (the real build)', async () => {
    const real = sessionRoutes.pipe(
      Layer.provideMerge(
        activeSessionLayer(conversationConfig(), 'opus', fakeSources({}).sources).pipe(
          Layer.provide(Layer.merge(unusedProviders, NodeServices.layer)),
        ),
      ),
    );
    await withApp(HttpRouter.toWebHandler(real, { disableLogger: true }), async (send) => {
      const response = await send(routes.session, {
        method: 'POST',
        json: { mode: 'continue', agent: 'codex', sessionId: 'nope' },
      });
      assert.equal(response.status, startStatus.failed);
      assert.deepEqual(await response.json(), {
        _tag: 'StartFailed',
        reason: 'InvalidSessionId',
      });
      assert.deepEqual(await statusOver(send), { _tag: 'NoSession' });
    });
  });
});

describe('DELETE /api/session/:sessionId', () => {
  it('answers 404 NoSession for a session that is not the live one, leaving it live', async () => {
    await withApp(app(), async (send) => {
      const id = await startOver(send);
      const response = await send(sessionPaths('unknown').session, { method: 'DELETE' });
      assert.equal(response.status, resetStatus.gone);
      assert.deepEqual(await response.json(), { _tag: 'NoSession' });
      assert.deepEqual(await statusOver(send), { _tag: 'Active', id });
    });
  });

  it('resets the live session with 204, after which its ID is gone', async () => {
    await withApp(app(), async (send) => {
      const id = await startOver(send);
      assert.equal(
        (await send(sessionPaths(id).session, { method: 'DELETE' })).status,
        resetStatus.reset,
      );
      assert.deepEqual(await statusOver(send), { _tag: 'NoSession' });
      assert.equal(
        (await send(sessionPaths(id).session, { method: 'DELETE' })).status,
        resetStatus.gone,
      );
    });
  });
});
