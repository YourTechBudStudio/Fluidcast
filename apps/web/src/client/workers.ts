import { Effect, Schema, type Scope, Stream } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpClientError } from 'effect/http';

import { sessionPaths, SkillsJson, skillsStatus } from '@fluidcast/app-contract';
import type { TransportError } from '@yourtechbudstudio/fluidcast-client';
import {
  TranscriptMessage,
  WorkerSummary,
  type Skill,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { fromStatus, isTransportError, sseStream, toTransportError } from './http';

/** Runs a stream with its own HTTP client, scoped to the stream, so ending the stream aborts the request. */
const withClient = <A, E>(
  use: (
    client: HttpClient.HttpClient.With<HttpClientError.HttpClientError, Scope.Scope>,
  ) => Stream.Stream<A, E>,
): Stream.Stream<A, E> =>
  Stream.unwrap(
    Effect.map(HttpClient.HttpClient, (client) => use(HttpClient.withScope(client))),
  ).pipe(Stream.provide(FetchHttpClient.layer));

/** Opens one Worker route's SSE stream, each message decoded with `schema`. */
const watch = <A>(path: string, schema: Schema.Decoder<A>) =>
  withClient((client) =>
    sseStream(client, path, schema, {
      onFailure: (response) => Effect.fail(fromStatus(response.status)),
      isKnown: isTransportError,
    }),
  );

/** The session's worker status: its summary now, then again whenever its status, session ID or background-task count changes. */
export const watchWorker = (sessionId: string): Stream.Stream<WorkerSummary, TransportError> =>
  watch(sessionPaths(sessionId).worker, WorkerSummary);

/** The session's worker transcript: a snapshot, then appended entries. */
export const watchTranscript = (
  sessionId: string,
): Stream.Stream<TranscriptMessage, TransportError> =>
  watch(sessionPaths(sessionId).workerTranscript, TranscriptMessage);

/**
 * The skills the session's worker can be sent as `/name`. Any failure, `SkillsUnavailable` included, is a
 * `TransportError`: the player only leaves its suggestions out.
 */
export const readSkills = (
  sessionId: string,
): Effect.Effect<ReadonlyArray<Skill>, TransportError> =>
  Effect.gen(function* () {
    const client = HttpClient.withScope(yield* HttpClient.HttpClient);
    const response = yield* client.execute(
      HttpClientRequest.get(sessionPaths(sessionId).workerSkills).pipe(
        HttpClientRequest.acceptJson,
      ),
    );
    if (response.status !== skillsStatus.ok) return yield* fromStatus(response.status);
    return yield* Effect.flatMap(response.text, Schema.decodeEffect(SkillsJson));
  }).pipe(Effect.scoped, Effect.mapError(toTransportError), Effect.provide(FetchHttpClient.layer));
