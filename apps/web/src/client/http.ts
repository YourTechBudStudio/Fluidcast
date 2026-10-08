import { Effect, Option, Schema, type Scope, Stream } from 'effect';
import { Sse } from 'effect/encoding';
import {
  HttpClientError,
  HttpClientRequest,
  type HttpClient,
  type HttpClientResponse,
} from 'effect/http';

import { TransportError } from '@yourtechbudstudio/fluidcast-client';

// The HTTP plumbing the page's transports share: status and error mapping, and SSE reading. Private to `client`.

/** A status with no failure body the contract knows: the class of status is all there is to go on. */
export const fromStatus = (status: number): TransportError =>
  new TransportError({
    reason: status >= 500 ? 'ServerError' : status >= 400 ? 'BadRequest' : 'Malformed',
    status,
  });

export const isTransportError = (error: unknown): error is TransportError =>
  error instanceof TransportError;

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
export const toTransportError = (error: unknown): TransportError => {
  if (error instanceof TransportError) return error;
  if (HttpClientError.isHttpClientError(error)) return fromHttpError(error);
  return new TransportError({ reason: 'Malformed' });
};

/**
 * Reads a failure response's body as one of the contract's tagged errors. A body that is missing or
 * unknown falls back to the status.
 */
export const failureOf = <A, I>(
  schema: Schema.Codec<A, I>,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<Option.Option<A>> =>
  response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)), Effect.option);

/**
 * `GET path` as Server-Sent Events in the app contract's framing, each `data:` line JSON-decoded
 * with `schema`. A status other than `200` fails with `onFailure`'s error; every failure that is not
 * one of those (`isKnown`) becomes a `TransportError`.
 */
export const sseStream = <A, E, R>(
  client: HttpClient.HttpClient.With<HttpClientError.HttpClientError, R>,
  path: string,
  schema: Schema.Decoder<A>,
  options: {
    readonly onFailure: (
      response: HttpClientResponse.HttpClientResponse,
    ) => Effect.Effect<never, E>;
    readonly isKnown: (error: unknown) => error is E;
  },
): Stream.Stream<A, E | TransportError, Exclude<R, Scope.Scope>> =>
  Stream.unwrap(
    Effect.flatMap(
      client.execute(
        HttpClientRequest.get(path).pipe(HttpClientRequest.accept('text/event-stream')),
      ),
      (response) =>
        response.status === 200 ? Effect.succeed(response.stream) : options.onFailure(response),
    ),
  ).pipe(
    Stream.decodeText,
    Stream.pipeThroughChannel(Sse.decodeDataSchema(schema)),
    Stream.map((event) => event.data),
    Stream.mapError((error) => (options.isKnown(error) ? error : toTransportError(error))),
  );
