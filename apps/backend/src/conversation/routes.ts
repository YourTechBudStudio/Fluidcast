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
import { Session } from '@yourtechbudstudio/fluidcast-harness';

import { sseResponse } from './sse.ts';
import { workerRoutes } from './worker-routes.ts';

const encodeMessage = Schema.encodeSync(SubscriptionMessageJson);
const failureJson = HttpServerResponse.schemaJson(CommandFailure);

/**
 * `GET /api/events`: the session subscription as SSE, one `data:` line per message, plus a
 * heartbeat comment. It ends after `Superseded`. When the client goes away the server interrupts
 * this response, which ends the subscription and freezes the cursor.
 */
const events = HttpRouter.add(
  'GET',
  routes.events,
  Effect.gen(function* () {
    const session = yield* Session;
    return sseResponse(
      session.subscribe().pipe(
        Stream.map((message) => encodeMessage(message)),
        Stream.onStart(Effect.logInfo('events: subscribed')),
        Stream.onExit((exit) =>
          Effect.logInfo(exit._tag === 'Success' ? 'events: ended' : 'events: disconnected'),
        ),
      ),
    );
  }),
);

/** `POST /api/commands`: applies one command. `204`, `409` when rejected, `400` when invalid. */
const commands = HttpRouter.add(
  'POST',
  routes.commands,
  Effect.gen(function* () {
    const session = yield* Session;
    const command = yield* HttpServerRequest.schemaBodyJson(CommandBody).pipe(
      Effect.mapError(() => new InvalidRequest()),
    );
    yield* Effect.logInfo('command').pipe(Effect.annotateLogs({ command: command._tag }));
    yield* session.command(command);
    return HttpServerResponse.empty({ status: commandStatus.applied });
  }).pipe(
    Effect.catchTags({
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

/** The conversation slice's routes. They need the `Session` and `ConversationWorker`. */
export const conversationRoutes = Layer.mergeAll(events, commands, workerRoutes);
