import { Effect, Layer, Option, Schema, Stream } from 'effect';
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
  CommandFailure,
  commandStatus,
  routes,
  SpeechFailure,
  speechPath,
  speechStatus,
} from '@fluidcast/app-contract';
import { Transport, TransportError } from '@yourtechbudstudio/fluidcast-client';
import { SubscriptionMessage, type Command } from '@yourtechbudstudio/fluidcast-harness/protocol';

/** A status with no failure body the contract knows: the class of status is all there is to go on. */
const fromStatus = (status: number): TransportError =>
  new TransportError({
    reason: status >= 500 ? 'ServerError' : status >= 400 ? 'BadRequest' : 'Malformed',
    status,
  });

/** Identifiers only: never a body or a URL. */
const fromHttpError = (error: HttpClientError.HttpClientError): TransportError => {
  const reason = error.reason;
  switch (reason._tag) {
    case 'TransportError':
      return new TransportError({ reason: 'Unreachable' });
    case 'EncodeError':
    case 'InvalidUrlError':
      return new TransportError({ reason: 'BadRequest' });
    case 'StatusCodeError':
      return fromStatus(reason.response.status);
    case 'DecodeError':
    case 'EmptyBodyError':
      return new TransportError({ reason: 'Malformed', status: reason.response.status });
  }
};

/**
 * Anything that is not already a `TransportError`: an HTTP client failure, or a reply that did not
 * decode (a schema or SSE framing failure), which means the backend broke the protocol.
 */
const toTransportError = (error: unknown): TransportError => {
  if (error instanceof TransportError) return error;
  if (HttpClientError.isHttpClientError(error)) return fromHttpError(error);
  return new TransportError({ reason: 'Malformed' });
};

/**
 * Reads a failure response's body as one of the contract's tagged errors. A body that is missing or
 * unknown falls back to the status.
 */
const failureOf = <A, I>(
  schema: Schema.Codec<A, I>,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<Option.Option<A>> =>
  response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)), Effect.option);

const encodeCommand = HttpClientRequest.schemaBodyJson(CommandBody);

/**
 * The reference app's transport: the Client SDK's `Transport` over the HTTP routes in
 * `@fluidcast/app-contract`. Paths are relative, so the page's own origin serves them (Vite's proxy in
 * development, the CLI in production). The analyser needs that: it only reads same-origin audio.
 *
 * Failures keep their meaning: a body the backend sends as one of the SDKs' tagged errors is decoded
 * back into that error, and everything else becomes a `TransportError` with a specific reason.
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
              : Effect.fail(fromStatus(response.status)),
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
        const failure = yield* failureOf(CommandFailure, response);
        if (Option.isNone(failure)) return yield* fromStatus(response.status);
        switch (failure.value._tag) {
          case 'CommandRejected':
            return yield* failure.value;
          case 'InvalidRequest':
            // Only this HTTP contract produces it: the SDK sees a request the backend could not accept.
            return yield* new TransportError({ reason: 'BadRequest', status: response.status });
        }
      }).pipe(
        Effect.scoped,
        Effect.mapError((error) =>
          error._tag === 'CommandRejected' ? error : toTransportError(error),
        ),
      );

    const speech = (actionId: string) =>
      Stream.unwrap(
        Effect.flatMap(client.execute(HttpClientRequest.get(speechPath(actionId))), (response) =>
          response.status === speechStatus.ok
            ? Effect.succeed(response.stream)
            : Effect.flatMap(failureOf(SpeechFailure, response), (failure) =>
                Effect.fail(Option.getOrElse(failure, () => fromStatus(response.status))),
              ),
        ),
      ).pipe(
        Stream.mapError((error) =>
          error._tag === 'SpeechNotFound' || error._tag === 'SpeechError'
            ? error
            : toTransportError(error),
        ),
      );

    return { subscribe, send, speech, speechUrl: speechPath };
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
