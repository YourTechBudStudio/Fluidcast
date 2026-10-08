import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Layer, Schema } from 'effect';
import { HttpRouter } from 'effect/http';

import {
  CommandBody,
  CommandFailure,
  commandStatus,
  noSessionStatus,
  sessionPaths,
  SubscriptionMessageJson,
} from '@fluidcast/app-contract';
import { CommandRejected } from '@yourtechbudstudio/fluidcast-harness/protocol';

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

  it('applies Pause, Play and Next, and answers Next with nothing ahead with a CommandRejected', async () => {
    await withApp(app(), async (send) => {
      const id = await startOver(send);
      for (const command of [{ _tag: 'Pause' }, { _tag: 'Pause' }, { _tag: 'Play' }]) {
        // Each body is exactly what the shared command schema encodes.
        const json = Schema.encodeSync(CommandBody)(Schema.decodeUnknownSync(CommandBody)(command));
        const response = await send(sessionPaths(id).commands, { method: 'POST', json });
        assert.equal(response.status, commandStatus.applied);
      }
      const rejected = await send(sessionPaths(id).commands, {
        method: 'POST',
        json: { _tag: 'Next' },
      });
      assert.equal(rejected.status, commandStatus.rejected);
      const body = Schema.decodeUnknownSync(CommandFailure)(await rejected.json());
      assert.deepEqual(body, new CommandRejected({ command: 'Next', phase: 'idle' }));
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

  it('carries the pause in the snapshot and as an event, decodable with the shared schema', async () => {
    await withApp(app(), async (send) => {
      const id = await startOver(send);
      const paused = await send(sessionPaths(id).commands, {
        method: 'POST',
        json: { _tag: 'Pause' },
      });
      assert.equal(paused.status, commandStatus.applied);
      const response = await send(sessionPaths(id).events);
      assert.ok(response.body);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      // The snapshot arrives first; the subscription is then live.
      let text = decoder.decode((await reader.read()).value);
      const played = await send(sessionPaths(id).commands, {
        method: 'POST',
        json: { _tag: 'Play' },
      });
      assert.equal(played.status, commandStatus.applied);
      while (!text.includes('PauseChanged')) {
        const chunk = await reader.read();
        assert.ok(!chunk.done, 'the stream ended before the event');
        text += decoder.decode(chunk.value);
      }
      await reader.cancel();
      const messages = text
        .split('\n')
        .filter((frame) => frame.startsWith('data: '))
        .map((frame) => Schema.decodeUnknownSync(SubscriptionMessageJson)(frame.slice(6)));
      const [snapshot, ...events] = messages;
      assert.equal(snapshot?._tag, 'Snapshot');
      assert.equal(snapshot._tag === 'Snapshot' && snapshot.state.paused, true);
      assert.deepEqual(snapshot._tag === 'Snapshot' && snapshot.state.pendingProgress, []);
      assert.deepEqual(events, [{ _tag: 'PauseChanged', paused: false }]);
    });
  });
});
