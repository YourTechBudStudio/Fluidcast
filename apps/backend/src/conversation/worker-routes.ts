import { Effect, Layer, Schema, Stream } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { routes } from '@fluidcast/app-contract';
import {
  TranscriptMessageJson,
  WorkerSummaryJson,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { sseResponse } from './sse.ts';
import { ConversationWorker } from './worker.ts';

const encodeSummary = Schema.encodeSync(WorkerSummaryJson);
const encodeTranscript = Schema.encodeSync(TranscriptMessageJson);

/** Logs a stream's connection, with the route only, never its content. */
const logConnection =
  (route: string) =>
  <A, E, R>(stream: Stream.Stream<A, E, R>) =>
    stream.pipe(
      Stream.onStart(Effect.logInfo(`${route}: subscribed`)),
      Stream.onExit((exit) =>
        Effect.logInfo(exit._tag === 'Success' ? `${route}: ended` : `${route}: disconnected`),
      ),
    );

/** `GET /api/worker`: the worker's status as SSE, one `WorkerSummary` per change. */
const status = HttpRouter.add(
  'GET',
  routes.worker,
  Effect.gen(function* () {
    const worker = yield* ConversationWorker;
    return sseResponse(
      worker.status.pipe(
        Stream.map((summary) => encodeSummary(summary)),
        logConnection('worker'),
      ),
    );
  }),
);

/** `GET /api/worker/transcript`: the worker's transcript as SSE, a snapshot then appended entries. */
const transcript = HttpRouter.add(
  'GET',
  routes.workerTranscript,
  Effect.gen(function* () {
    const worker = yield* ConversationWorker;
    return sseResponse(
      worker.transcript.pipe(
        Stream.map((message) => encodeTranscript(message)),
        logConnection('worker transcript'),
      ),
    );
  }),
);

/** The Worker view's routes. They need `ConversationWorker`. */
export const workerRoutes = Layer.mergeAll(status, transcript);
