import * as NodeHttpServerRequest from '@effect/platform-node/NodeHttpServerRequest';
import { Cause, Effect, Exit, Pull, Schema, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { routes, SpeechFailure, speechStatus } from '@fluidcast/app-contract';
import { audioMimeType, type AudioFormat } from '@yourtechbudstudio/fluidcast-core/speech';
import { Session } from '@yourtechbudstudio/fluidcast-harness';

const failureJson = HttpServerResponse.schemaJson(SpeechFailure);

/**
 * `GET /api/speech/:actionId`: streams the speak's audio as the provider produces it.
 *
 * The first chunk is pulled before any header is sent, so an unknown action is a `404` and a
 * synthesis failure before audio starts is a `502`. A failure after that aborts the connection,
 * because ending the response normally would make a truncated clip look complete.
 */
export const speechRoutes = (format: AudioFormat) =>
  HttpRouter.add(
    'GET',
    routes.speech,
    Effect.gen(function* () {
      const session = yield* Session;
      const { actionId } = yield* HttpRouter.schemaPathParams(
        Schema.Struct({ actionId: Schema.String }),
      );
      const annotate = Effect.annotateLogs({ actionId });

      // Scoped to the request, which stays open until the response body has been written.
      const pull = yield* Stream.toPull(session.speech(actionId));
      const first = yield* pull.pipe(
        Pull.catchDone(() => Effect.succeed<ReadonlyArray<Uint8Array>>([])),
      );

      const response = NodeHttpServerRequest.toServerResponse(
        yield* HttpServerRequest.HttpServerRequest,
      );
      const body = Stream.concat(
        Stream.fromIterable(first),
        Stream.fromPull(Effect.succeed(pull)),
      ).pipe(
        Stream.onExit((exit) => {
          if (Exit.isSuccess(exit)) return Effect.void;
          const abort = Effect.sync(() => response.destroy());
          // Interruption means the client went away; anything else is a synthesis failure.
          if (Cause.hasInterruptsOnly(exit.cause)) return abort;
          return Effect.andThen(
            Effect.logWarning('speech: failed after audio started').pipe(annotate),
            abort,
          );
        }),
      );
      return HttpServerResponse.stream(body, { contentType: audioMimeType[format] });
    }).pipe(
      Effect.catchTags({
        SpeechNotFound: (error) =>
          Effect.logInfo('speech: not found').pipe(
            Effect.annotateLogs({ actionId: error.actionId }),
            Effect.andThen(failureJson(error, { status: speechStatus.notFound })),
          ),
        SpeechError: (error) =>
          Effect.logWarning('speech: synthesis failed').pipe(
            Effect.annotateLogs({ reason: error.reason, status: error.status }),
            Effect.andThen(failureJson(error, { status: speechStatus.unavailable })),
          ),
      }),
      Effect.orDie,
    ),
  );
