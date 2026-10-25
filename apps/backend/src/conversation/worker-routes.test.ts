import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect, Layer, Schema, Stream } from 'effect';
import { HttpRouter } from 'effect/http';

import {
  noSessionStatus,
  sessionPaths,
  SkillsJson,
  skillsStatus,
  workerStatus,
} from '@fluidcast/app-contract';
import type { WorkerHandle } from '@yourtechbudstudio/fluidcast-tool-agent';
import {
  SkillsUnavailable,
  type Skill,
  TranscriptMessageJson,
  WorkerSummaryJson,
  type TranscriptMessage,
  type WorkerSummary,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import {
  dataOf,
  fakeActiveLayer,
  fakeBuild,
  fakeWorkerHandle,
  startOver,
  withApp,
} from './fixtures.test.ts';
import { sessionRoutes } from './session-routes.ts';
import { workerRoutes } from './worker-routes.ts';

const decodeSummary = Schema.decodeSync(WorkerSummaryJson);
const decodeTranscript = Schema.decodeSync(TranscriptMessageJson);
const decodeSkills = Schema.decodeSync(SkillsJson);

const idle: WorkerSummary = {
  _tag: 'WorkerSummary',
  status: 'idle',
  sessionId: 'session-1',
  backgroundTasks: 0,
};
const working: WorkerSummary = { ...idle, status: 'working' };

const snapshot: TranscriptMessage = {
  _tag: 'TranscriptSnapshot',
  entries: [{ _tag: 'prompt', parentToolUseId: null, source: 'fluidcast', text: 'Go.' }],
};

const appended: TranscriptMessage = {
  _tag: 'TranscriptAppended',
  entries: [{ _tag: 'text', parentToolUseId: null, text: 'Looking.' }],
};

const listed: ReadonlyArray<Skill> = [
  { name: 'designing-ui', description: 'Explore distinct UI variants.' },
  { name: 'create-implementation-plan', description: 'Plan it.', argumentHint: '[focus]' },
];

/** The Worker routes, and the lifecycle routes to start a session, over a fake worker. */
const app = (worker: Partial<WorkerHandle> = {}) =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(workerRoutes, sessionRoutes).pipe(
      Layer.provideMerge(
        fakeActiveLayer(
          fakeBuild({
            worker: {
              ...fakeWorkerHandle(),
              status: Stream.make(idle, working),
              transcript: Stream.make(snapshot, appended),
              skills: Effect.succeed(listed),
              ...worker,
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

describe('GET /api/session/:sessionId/worker/skills', () => {
  it("answers the worker's skills as JSON", async () => {
    await withApp(app(), async (send) => {
      const response = await send(sessionPaths(await startOver(send)).workerSkills);
      assert.equal(response.status, skillsStatus.ok);
      assert.equal(response.headers.get('content-type'), 'application/json');
      assert.deepEqual(decodeSkills(await response.text()), listed);
    });
  });

  it('answers 502 SkillsUnavailable when the worker cannot list them', async () => {
    const unavailable = app({
      skills: Effect.fail(new SkillsUnavailable({ reason: 'TimedOut' })),
    });
    await withApp(unavailable, async (send) => {
      const response = await send(sessionPaths(await startOver(send)).workerSkills);
      assert.equal(response.status, skillsStatus.unavailable);
      assert.deepEqual(await response.json(), { _tag: 'SkillsUnavailable', reason: 'TimedOut' });
    });
  });

  it('answers 404 NoSession for a session that is not the live one', async () => {
    await withApp(app(), async (send) => {
      await startOver(send);
      const response = await send(sessionPaths('other').workerSkills);
      assert.equal(response.status, noSessionStatus);
      assert.deepEqual(await response.json(), { _tag: 'NoSession' });
    });
  });
});
