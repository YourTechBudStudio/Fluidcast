import { Effect, Layer, Schema, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  InvalidRequest,
  NoSession,
  noSessionStatus,
  resetStatus,
  routes,
  SessionStatusJson,
  StartFailure,
  StartRequest,
  startStatus,
} from '@fluidcast/app-contract';

import { ActiveSession } from './active.ts';
import { logConnection, sseResponse } from './sse.ts';

const encodeStatus = Schema.encodeSync(SessionStatusJson);
const startFailureJson = HttpServerResponse.schemaJson(StartFailure);
const noSessionJson = HttpServerResponse.schemaJson(NoSession);

/** The live session if `sessionId` names it; otherwise `NoSession`. Every per-session route's gate. */
export const liveSession = (sessionId: string) =>
  Effect.gen(function* () {
    return yield* (yield* ActiveSession).current(sessionId);
  });

/** `404 NoSession`: the addressed session is not the live one. */
export const noSessionResponse = (error: NoSession) =>
  Effect.logInfo('no session').pipe(
    Effect.andThen(noSessionJson(error, { status: noSessionStatus })),
  );

/** `GET /api/session`: which session is live, as SSE: the current status, then each change. */
const status = HttpRouter.add(
  'GET',
  routes.session,
  Effect.gen(function* () {
    const active = yield* ActiveSession;
    return sseResponse(
      active.status.pipe(
        Stream.map((value) => encodeStatus(value)),
        logConnection('session status'),
      ),
    );
  }),
);

/**
 * `POST /api/session`: starts a session. `204`; `400` when the body is invalid; `409` while a
 * session is live; `422` when it could not be started.
 */
const start = HttpRouter.add(
  'POST',
  routes.session,
  Effect.gen(function* () {
    const active = yield* ActiveSession;
    const request = yield* HttpServerRequest.schemaBodyJson(StartRequest).pipe(
      Effect.mapError(() => new InvalidRequest()),
    );
    yield* active.start(request);
    return HttpServerResponse.empty({ status: startStatus.started });
  }).pipe(
    Effect.catchTags({
      InvalidRequest: (error) =>
        Effect.logInfo('session: invalid start request').pipe(
          Effect.andThen(startFailureJson(error, { status: startStatus.invalid })),
        ),
      SessionActive: (error) => startFailureJson(error, { status: startStatus.active }),
      StartFailed: (error) => startFailureJson(error, { status: startStatus.failed }),
    }),
    Effect.orDie,
  ),
);

/** `DELETE /api/session/:sessionId`: Reset. `204` once discarded; `404` if it is not the live one. */
const reset = HttpRouter.add(
  'DELETE',
  routes.activeSession,
  Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.schemaPathParams(
      Schema.Struct({ sessionId: Schema.String }),
    );
    yield* (yield* ActiveSession).reset(sessionId);
    return HttpServerResponse.empty({ status: resetStatus.reset });
  }).pipe(Effect.catchTags({ NoSession: noSessionResponse }), Effect.orDie),
);

/** The session lifecycle's routes. They need `ActiveSession`. */
export const sessionRoutes = Layer.mergeAll(status, start, reset);
