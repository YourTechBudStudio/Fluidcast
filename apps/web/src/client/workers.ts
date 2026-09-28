import { Effect, Option, type Scope, Stream } from 'effect';
import { FetchHttpClient, HttpClient, type HttpClientError } from 'effect/unstable/http';

import { routes, workerStatus, workerTranscriptPath } from '@fluidcast/app-contract';
import { TransportError } from '@yourtechbudstudio/fluidcast-client';
import {
  TranscriptMessage,
  WorkerList,
  WorkerNotFound,
  type WorkerSummary,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { failureOf, fromStatus, sseStream } from './http';

/** Runs a stream with its own HTTP client, scoped to the stream, so ending the stream aborts the request. */
const withClient = <A, E>(
  use: (
    client: HttpClient.HttpClient.With<HttpClientError.HttpClientError, Scope.Scope>,
  ) => Stream.Stream<A, E>,
): Stream.Stream<A, E> =>
  Stream.unwrap(
    Effect.map(HttpClient.HttpClient, (client) => use(HttpClient.withScope(client))),
  ).pipe(Stream.provide(FetchHttpClient.layer));

const isTransportError = (error: unknown): error is TransportError =>
  error instanceof TransportError;

/** The backend's live workers, in creation order: the whole list again whenever it changes. */
export const watchWorkers = (): Stream.Stream<ReadonlyArray<WorkerSummary>, TransportError> =>
  withClient((client) =>
    sseStream(client, routes.workers, WorkerList, {
      onFailure: (response) => Effect.fail(fromStatus(response.status)),
      isKnown: isTransportError,
    }).pipe(Stream.map((list) => list.workers)),
  );

/**
 * One worker's transcript: a snapshot, then appended entries. Fails with `WorkerNotFound` when the
 * backend's pool has no such worker.
 */
export const watchTranscript = (
  agent: string,
): Stream.Stream<TranscriptMessage, TransportError | WorkerNotFound> =>
  withClient((client) =>
    sseStream(client, workerTranscriptPath(agent), TranscriptMessage, {
      onFailure: (response) =>
        response.status === workerStatus.notFound
          ? Effect.flatMap(failureOf(WorkerNotFound, response), (failure) =>
              Effect.fail(Option.getOrElse(failure, () => fromStatus(response.status))),
            )
          : Effect.fail(fromStatus(response.status)),
      isKnown: (error): error is TransportError | WorkerNotFound =>
        isTransportError(error) || error instanceof WorkerNotFound,
    }),
  );
