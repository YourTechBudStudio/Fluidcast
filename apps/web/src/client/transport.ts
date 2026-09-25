import { Effect, Layer, Schema, Stream } from 'effect';
import { Sse } from 'effect/unstable/encoding';
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  type HttpClientResponse,
} from 'effect/unstable/http';

import {
  CommandBody,
  commandStatus,
  routes,
  speechPath,
  speechStatus,
} from '@fluidcast/app-contract';
import { Transport, TransportError } from '@yourtechbudstudio/fluidcast-client';
import {
  CommandRejected,
  SpeechNotFound,
  SubscriptionMessage,
  type Command,
} from '@yourtechbudstudio/fluidcast-harness/protocol';

/** Identifiers only: the failure's tag and, where there is one, the HTTP status. Never a body or a URL. */
const toTransportError = (error: { readonly _tag: string }): TransportError => {
  if (error instanceof TransportError) return error;
  if (HttpClientError.isHttpClientError(error)) {
    const reason = error.reason;
    const status = 'response' in reason ? reason.response.status : undefined;
    return new TransportError({ reason: reason._tag, ...(status === undefined ? {} : { status }) });
  }
  return new TransportError({ reason: error._tag });
};

const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
  new TransportError({ reason: 'UnexpectedStatus', status: response.status });

const decodeRejected = Schema.decodeUnknownEffect(CommandRejected);
const encodeCommand = HttpClientRequest.schemaBodyJson(CommandBody);

/**
 * The reference app's transport: the Client SDK's `Transport` over the HTTP routes in
 * `@fluidcast/app-contract`. Paths are relative, so the page's own origin serves them (Vite's proxy in
 * development, the CLI in production). The analyser needs that: it only reads same-origin audio.
 */
export const httpTransport: Layer.Layer<Transport> = Layer.effect(
  Transport,
  Effect.gen(function* () {
    // Each request lives in its stream's or effect's scope, so interrupting it aborts the fetch.
    const client = HttpClient.withScope(yield* HttpClient.HttpClient);

    const subscribe = () =>
      Stream.unwrap(
        Effect.flatMap(
          client.execute(
            HttpClientRequest.get(routes.events).pipe(
              HttpClientRequest.accept('text/event-stream'),
            ),
          ),
          (response) =>
            response.status === 200
              ? Effect.succeed(response.stream)
              : Effect.fail(unexpectedStatus(response)),
        ),
      ).pipe(
        Stream.decodeText,
        Stream.pipeThroughChannel(Sse.decodeDataSchema(SubscriptionMessage)),
        Stream.map((event) => event.data),
        Stream.mapError(toTransportError),
      );

    const send = (command: Command) =>
      Effect.gen(function* () {
        const response = yield* client.execute(
          yield* encodeCommand(HttpClientRequest.post(routes.commands), command),
        );
        if (response.status === commandStatus.applied) return;
        if (response.status === commandStatus.rejected) {
          // The decoded rejection is the command's failure, not its result.
          return yield* Effect.fail(yield* Effect.flatMap(response.json, decodeRejected));
        }
        return yield* unexpectedStatus(response);
      }).pipe(
        Effect.scoped,
        Effect.mapError((error) =>
          error instanceof CommandRejected ? error : toTransportError(error),
        ),
      );

    const speech = (actionId: string) =>
      Stream.unwrap(
        Effect.flatMap(client.execute(HttpClientRequest.get(speechPath(actionId))), (response) =>
          response.status === speechStatus.ok
            ? Effect.succeed(response.stream)
            : Effect.fail(
                response.status === speechStatus.notFound
                  ? new SpeechNotFound({ actionId })
                  : unexpectedStatus(response),
              ),
        ),
      ).pipe(
        Stream.mapError((error) =>
          error instanceof SpeechNotFound ? error : toTransportError(error),
        ),
      );

    return { subscribe, send, speech, speechUrl: speechPath };
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
