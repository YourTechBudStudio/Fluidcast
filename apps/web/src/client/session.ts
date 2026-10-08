import { Effect, Option, Schedule, Stream } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { AsyncResult, Atom } from 'effect/reactivity';

import {
  resetStatus,
  routes,
  type SessionActive,
  sessionPaths,
  SessionStatus,
  type StartFailed,
  StartFailure,
  StartRequest,
  startStatus,
} from '@fluidcast/app-contract';
import { TransportError } from '@yourtechbudstudio/fluidcast-client';

import { failureOf, fromStatus, isTransportError, sseStream, toTransportError } from './http';

// The backend session's lifecycle: which session is live, starting one, and Reset.

/**
 * The backend session this registry belongs to. The root seeds it in each session's own registry (`initialValues`); it
 * is never read outside one.
 */
export const sessionIdAtom = Atom.make('').pipe(Atom.keepAlive);

/**
 * Which backend session is live: `NoSession` now, or `Active(id)`, then again on each change. `sseStream` already
 * JSON-decodes each frame, so it takes `SessionStatus` itself.
 */
export const watchSessionStatus = (): Stream.Stream<
  SessionStatus,
  TransportError,
  HttpClient.HttpClient
> =>
  Stream.unwrap(
    Effect.map(HttpClient.HttpClient, (client) =>
      sseStream(HttpClient.withScope(client), routes.session, SessionStatus, {
        onFailure: (response) => Effect.fail(fromStatus(response.status)),
        isKnown: isTransportError,
      }),
    ),
  );

const statusResultAtom = Atom.make(
  watchSessionStatus().pipe(
    // The backend ends the stream only when it shuts down: treat that like a dropped connection.
    Stream.concat(Stream.fail(new TransportError({ reason: 'Closed' }))),
    Stream.retry(Schedule.spaced('1 second')),
    Stream.provide(FetchHttpClient.layer),
  ),
);

/**
 * The live backend session as the page knows it; `None` until the first status arrives. It reconnects forever and keeps
 * the last status meanwhile. It belongs to the page's root registry: nothing inside a session registry may read it,
 * because that would open a second status stream for each session.
 */
export const sessionStatusAtom = Atom.make((get): Option.Option<SessionStatus> =>
  AsyncResult.value(get(statusResultAtom)),
).pipe(Atom.keepAlive);

const encodeStart = HttpClientRequest.schemaBodyJson(StartRequest);

/** `POST /api/session`. Its success shows only on the status stream, which then reports `Active`. */
export const startSession = (
  request: StartRequest,
): Effect.Effect<void, StartFailed | SessionActive | TransportError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = HttpClient.withScope(yield* HttpClient.HttpClient);
    const response = yield* client.execute(
      yield* encodeStart(HttpClientRequest.post(routes.session), request),
    );
    if (response.status === startStatus.started) return;
    const failure = yield* failureOf(StartFailure, response);
    if (Option.isNone(failure)) return yield* fromStatus(response.status);
    switch (failure.value._tag) {
      case 'StartFailed':
      case 'SessionActive':
        return yield* failure.value;
      case 'InvalidRequest':
        return yield* new TransportError({ reason: 'BadRequest', status: response.status });
    }
  }).pipe(
    Effect.scoped,
    Effect.mapError((error) =>
      error._tag === 'StartFailed' || error._tag === 'SessionActive'
        ? error
        : toTransportError(error),
    ),
  );

/** Starts a session from the mode screen. */
export const startSessionAtom = Atom.fn((request: StartRequest) =>
  startSession(request).pipe(Effect.provide(FetchHttpClient.layer)),
);

/**
 * `DELETE /api/session/:sessionId`. `204` and `404` both succeed: the session is gone either way. The page leaves it
 * only once the status stream says so.
 */
export const resetSession = (
  sessionId: string,
): Effect.Effect<void, TransportError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = HttpClient.withScope(yield* HttpClient.HttpClient);
    const response = yield* client.execute(
      HttpClientRequest.delete(sessionPaths(sessionId).session),
    );
    if (response.status === resetStatus.reset || response.status === resetStatus.gone) return;
    return yield* fromStatus(response.status);
  }).pipe(Effect.scoped, Effect.mapError(toTransportError));
