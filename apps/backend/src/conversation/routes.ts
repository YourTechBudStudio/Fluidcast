import { Effect, Layer, Schema, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  CommandBody,
  CommandFailure,
  commandStatus,
  InvalidRequest,
  routes,
  SubscriptionMessageJson,
} from '@fluidcast/app-contract';

import { liveSession, noSessionResponse, sessionRoutes } from './session-routes.ts';
import { logConnection, sseResponse } from './sse.ts';
import { workerRoutes } from './worker-routes.ts';

const encodeMessage = Schema.encodeSync(SubscriptionMessageJson);
const failureJson = HttpServerResponse.schemaJson(CommandFailure);
const SessionParams = Schema.Struct({ sessionId: Schema.String });

/**
 * `GET /api/session/:sessionId/events`: the session subscription as SSE, one `data:` line per
 * message, plus a heartbeat comment. It ends after `Superseded`, or when the session is discarded.
 * When the client goes away the server interrupts this response, which ends the subscription and
 * freezes the cursor. `404 NoSession` for a session that is not live.
 */
const events = HttpRouter.add(
  'GET',
  routes.events,
  Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.schemaPathParams(SessionParams);
    const live = yield* liveSession(sessionId);
    return sseResponse(
      live.bound(live.session.subscribe()).pipe(
        Stream.map((message) => encodeMessage(message)),
        logConnection('events'),
      ),
    );
  }).pipe(Effect.catchTags({ NoSession: noSessionResponse }), Effect.orDie),
);

/**
 * `POST /api/session/:sessionId/commands`: applies one command. `204`, `409` when rejected, `400`
 * when invalid, `404` when the session is not live.
 */
const commands = HttpRouter.add(
  'POST',
  routes.commands,
  Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.schemaPathParams(SessionParams);
    const { session } = yield* liveSession(sessionId);
    const command = yield* HttpServerRequest.schemaBodyJson(CommandBody).pipe(
      Effect.mapError(() => new InvalidRequest()),
    );
    yield* Effect.logInfo('command').pipe(Effect.annotateLogs({ command: command._tag }));
    yield* session.command(command);
    return HttpServerResponse.empty({ status: commandStatus.applied });
  }).pipe(
    Effect.catchTags({
      NoSession: noSessionResponse,
      InvalidRequest: (error) =>
        Effect.logInfo('command: invalid request').pipe(
          Effect.andThen(failureJson(error, { status: commandStatus.invalid })),
        ),
      CommandRejected: (error) =>
        Effect.logInfo('command: rejected').pipe(
          Effect.annotateLogs({ command: error.command, phase: error.phase }),
          Effect.andThen(failureJson(error, { status: commandStatus.rejected })),
        ),
      ToolCommandRejected: (error) =>
        Effect.logInfo('command: tool command rejected').pipe(
          Effect.annotateLogs({ reason: error.reason }),
          Effect.andThen(failureJson(error, { status: commandStatus.rejected })),
        ),
    }),
    Effect.orDie,
  ),
);

/** The conversation slice's routes. They need `ActiveSession`. */
export const conversationRoutes = Layer.mergeAll(sessionRoutes, events, commands, workerRoutes);
