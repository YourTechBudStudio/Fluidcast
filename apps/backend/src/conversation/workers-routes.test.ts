import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect, Layer, Schema, Stream } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { routes, workerStatus, workerTranscriptPath } from '@fluidcast/app-contract';
import {
  TranscriptMessageJson,
  WorkerListJson,
  WorkerNotFound,
  type TranscriptMessage,
  type WorkerSummary,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { workersRoutes } from './workers-routes.ts';
import { AgentWorkers } from './workers.ts';

const summary: WorkerSummary = {
  agent: 'brainstorm',
  agentType: 'claude',
  status: 'working',
  sessionId: 'session-1',
};

const snapshot: TranscriptMessage = {
  _tag: 'TranscriptSnapshot',
  agent: 'brainstorm',
  sessionId: 'session-1',
  entries: [{ _tag: 'prompt', parentToolUseId: null, source: 'fluidcast', text: 'Go.' }],
};

const appended: TranscriptMessage = {
  _tag: 'TranscriptAppended',
  entries: [{ _tag: 'text', parentToolUseId: null, text: 'Looking.' }],
};

/** The Workers routes over a fake pool with one worker, `brainstorm`. */
const app = workersRoutes.pipe(
  Layer.provideMerge(
    Layer.succeed(
      AgentWorkers,
      AgentWorkers.of({
        list: Stream.make([], [summary]),
        transcript: (agent) =>
          agent === 'brainstorm'
            ? Effect.succeed(Stream.make(snapshot, appended))
            : Effect.fail(new WorkerNotFound({ agent })),
      }),
    ),
  ),
);

const get = async (path: string) => {
  const { handler, dispose } = HttpRouter.toWebHandler(app, { disableLogger: true });
  try {
    const response = await handler(new Request(`http://localhost${path}`));
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      text: await response.text(),
    };
  } finally {
    await dispose();
  }
};

/** The `data:` payloads of an SSE body, in order. */
const dataOf = (body: string) =>
  body
    .split('\n\n')
    .filter((event) => event.startsWith('data: '))
    .map((event) => event.slice('data: '.length));

describe('GET /api/workers', () => {
  it('streams each worker list as one SSE message', async () => {
    const response = await get(routes.workers);
    assert.equal(response.status, workerStatus.ok);
    assert.equal(response.type, 'text/event-stream');
    assert.deepEqual(dataOf(response.text).map(Schema.decodeSync(WorkerListJson)), [
      { _tag: 'WorkerList', workers: [] },
      { _tag: 'WorkerList', workers: [summary] },
    ]);
  });
});

describe('GET /api/workers/:agent/transcript', () => {
  it('streams the snapshot, then appended entries', async () => {
    const response = await get(workerTranscriptPath('brainstorm'));
    assert.equal(response.status, workerStatus.ok);
    assert.equal(response.type, 'text/event-stream');
    assert.deepEqual(dataOf(response.text).map(Schema.decodeSync(TranscriptMessageJson)), [
      snapshot,
      appended,
    ]);
  });

  it('answers an unknown worker with 404 and WorkerNotFound, without a stream', async () => {
    const response = await get(workerTranscriptPath('nobody'));
    assert.equal(response.status, workerStatus.notFound);
    assert.deepEqual(JSON.parse(response.text), { _tag: 'WorkerNotFound', agent: 'nobody' });
  });
});
