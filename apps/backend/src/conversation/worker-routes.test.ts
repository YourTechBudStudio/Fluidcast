import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Layer, Schema, Stream } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { noSessionStatus, sessionPaths, workerStatus } from '@fluidcast/app-contract';
import {
  TranscriptMessageJson,
  WorkerSummaryJson,
  type TranscriptMessage,
  type WorkerSummary,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { dataOf, fakeActiveLayer, fakeBuild, startOver, withApp } from './fixtures.test.ts';
import { sessionRoutes } from './session-routes.ts';
import { workerRoutes } from './worker-routes.ts';

const decodeSummary = Schema.decodeSync(WorkerSummaryJson);
const decodeTranscript = Schema.decodeSync(TranscriptMessageJson);

const idle: WorkerSummary = { _tag: 'WorkerSummary', status: 'idle', sessionId: 'session-1' };
const working: WorkerSummary = { ...idle, status: 'working' };

const snapshot: TranscriptMessage = {
  _tag: 'TranscriptSnapshot',
  sessionId: 'session-1',
  entries: [{ _tag: 'prompt', parentToolUseId: null, source: 'fluidcast', text: 'Go.' }],
};

const appended: TranscriptMessage = {
  _tag: 'TranscriptAppended',
  entries: [{ _tag: 'text', parentToolUseId: null, text: 'Looking.' }],
};

/** The Worker routes, and the lifecycle routes to start a session, over a fake worker. */
const app = () =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(workerRoutes, sessionRoutes).pipe(
      Layer.provideMerge(
        fakeActiveLayer(
          fakeBuild({
            worker: {
              sessionId: 'session-1',
              status: Stream.make(idle, working),
              transcript: Stream.make(snapshot, appended),
            },
          }).build,
        ),
      ),
    ),
    { disableLogger: true },
  );

describe('GET /api/session/:sessionId/worker', () => {
  it('streams each status change as one SSE message', async () => {
    await withApp(app(), async (send) => {
      const response = await send(sessionPaths(await startOver(send)).worker);
      assert.equal(response.status, workerStatus.ok);
      assert.equal(response.headers.get('content-type'), 'text/event-stream');
      assert.deepEqual(
        dataOf(await response.text()).map((data) => decodeSummary(data)),
        [idle, working],
      );
    });
  });

  it('answers 404 NoSession for a session that is not the live one', async () => {
    await withApp(app(), async (send) => {
      await startOver(send);
      const response = await send(sessionPaths('other').worker);
      assert.equal(response.status, noSessionStatus);
      assert.deepEqual(await response.json(), { _tag: 'NoSession' });
    });
  });
});

describe('GET /api/session/:sessionId/worker/transcript', () => {
  it('streams the snapshot, then appended entries', async () => {
    await withApp(app(), async (send) => {
      const response = await send(sessionPaths(await startOver(send)).workerTranscript);
      assert.equal(response.status, workerStatus.ok);
      assert.equal(response.headers.get('content-type'), 'text/event-stream');
      assert.deepEqual(
        dataOf(await response.text()).map((data) => decodeTranscript(data)),
        [snapshot, appended],
      );
    });
  });

  it('answers 404 NoSession for a session that is not the live one', async () => {
    await withApp(app(), async (send) => {
      const response = await send(sessionPaths('none').workerTranscript);
      assert.equal(response.status, noSessionStatus);
      assert.deepEqual(await response.json(), { _tag: 'NoSession' });
    });
  });
});
