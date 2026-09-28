import { Effect, Layer, Schema, Stream } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';

import { routes, workerStatus } from '@fluidcast/app-contract';
import {
  TranscriptMessageJson,
  WorkerListJson,
  WorkerNotFound,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { sseResponse } from './sse.ts';
import { AgentWorkers } from './workers.ts';

const encodeList = Schema.encodeSync(WorkerListJson);
const encodeTranscript = Schema.encodeSync(TranscriptMessageJson);
const notFoundJson = HttpServerResponse.schemaJson(WorkerNotFound);

/** Logs a stream's connection, with the route and identifiers only, never its content. */
const logConnection =
  (route: string, annotations: Readonly<Record<string, string>> = {}) =>
  <A, E, R>(stream: Stream.Stream<A, E, R>) =>
    stream.pipe(
      Stream.onStart(Effect.logInfo(`${route}: subscribed`).pipe(Effect.annotateLogs(annotations))),
      Stream.onExit((exit) =>
        Effect.logInfo(exit._tag === 'Success' ? `${route}: ended` : `${route}: disconnected`).pipe(
          Effect.annotateLogs(annotations),
        ),
      ),
    );

/** `GET /api/workers`: the live workers as SSE, one `WorkerList` per change. */
const workers = HttpRouter.add(
  'GET',
  routes.workers,
  Effect.gen(function* () {
    const pool = yield* AgentWorkers;
    return sseResponse(
      pool.list.pipe(
        Stream.map((list) => encodeList({ _tag: 'WorkerList', workers: list })),
        logConnection('workers'),
      ),
    );
  }),
);

/**
 * `GET /api/workers/:agent/transcript`: one worker's transcript as SSE, a snapshot then appended
 * entries. `404` with `WorkerNotFound` before any stream opens when the pool has no such worker.
 */
const workerTranscript = HttpRouter.add(
  'GET',
  routes.workerTranscript,
  Effect.gen(function* () {
    const { agent } = yield* HttpRouter.schemaPathParams(Schema.Struct({ agent: Schema.String }));
    const pool = yield* AgentWorkers;
    return yield* pool.transcript(agent).pipe(
      Effect.map((transcript) =>
        sseResponse(
          transcript.pipe(
            Stream.map((message) => encodeTranscript(message)),
            logConnection('worker transcript', { agent }),
          ),
        ),
      ),
      Effect.catchTag('WorkerNotFound', (error) =>
        Effect.logInfo('worker transcript: not found').pipe(
          Effect.annotateLogs({ agent }),
          Effect.andThen(notFoundJson(error, { status: workerStatus.notFound })),
        ),
      ),
    );
  }).pipe(Effect.orDie),
);

/** The Workers view's routes. They need `AgentWorkers`. */
export const workersRoutes = Layer.mergeAll(workers, workerTranscript);
