import { Effect, type Schema, type Scope, Stream } from 'effect';
import { FetchHttpClient, HttpClient, type HttpClientError } from 'effect/unstable/http';

import { routes } from '@fluidcast/app-contract';
import { TransportError } from '@yourtechbudstudio/fluidcast-client';
import { TranscriptMessage, WorkerSummary } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { fromStatus, sseStream } from './http';

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

/** Opens one Worker route's SSE stream, each message decoded with `schema`. */
const watch = <A>(path: string, schema: Schema.Decoder<A>) =>
  withClient((client) =>
    sseStream(client, path, schema, {
      onFailure: (response) => Effect.fail(fromStatus(response.status)),
      isKnown: isTransportError,
    }),
  );

/** The worker's status: its summary now, then again whenever its status changes. */
export const watchWorker = (): Stream.Stream<WorkerSummary, TransportError> =>
  watch(routes.worker, WorkerSummary);

/** The worker's transcript: a snapshot, then appended entries. */
export const watchTranscript = (): Stream.Stream<TranscriptMessage, TransportError> =>
  watch(routes.workerTranscript, TranscriptMessage);
