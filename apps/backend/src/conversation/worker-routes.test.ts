import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Layer, Schema, Stream } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { routes, workerStatus } from '@fluidcast/app-contract';
import {
  TranscriptMessageJson,
  WorkerSummaryJson,
  type TranscriptMessage,
  type WorkerSummary,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { workerRoutes } from './worker-routes.ts';
import { ConversationWorker } from './worker.ts';

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

/** The Worker routes over a fake worker. */
const app = workerRoutes.pipe(
  Layer.provideMerge(
    Layer.succeed(
      ConversationWorker,
      ConversationWorker.of({
        sessionId: 'session-1',
        status: Stream.make(idle, working),
        transcript: Stream.make(snapshot, appended),
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

describe('GET /api/worker', () => {
  it('streams each status change as one SSE message', async () => {
    const response = await get(routes.worker);
    assert.equal(response.status, workerStatus.ok);
    assert.equal(response.type, 'text/event-stream');
    assert.deepEqual(dataOf(response.text).map(Schema.decodeSync(WorkerSummaryJson)), [
      idle,
      working,
    ]);
  });
});

describe('GET /api/worker/transcript', () => {
  it('streams the snapshot, then appended entries', async () => {
    const response = await get(routes.workerTranscript);
    assert.equal(response.status, workerStatus.ok);
    assert.equal(response.type, 'text/event-stream');
    assert.deepEqual(dataOf(response.text).map(Schema.decodeSync(TranscriptMessageJson)), [
      snapshot,
      appended,
    ]);
  });
});
