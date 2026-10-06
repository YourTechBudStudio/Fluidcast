import { Effect, Layer, Option, Stream } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/unstable/http';

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

import { failureOf, fromStatus, sseStream, toTransportError } from './http';

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
      sseStream(client, routes.events, SubscriptionMessage, {
        onFailure: (response) => Effect.fail(fromStatus(response.status)),
        isKnown: (error): error is TransportError => error instanceof TransportError,
      });

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
          case 'ToolCommandRejected':
            return yield* failure.value;
          case 'InvalidRequest':
            // Only this HTTP contract produces it: the SDK sees a request the backend could not accept.
            return yield* new TransportError({ reason: 'BadRequest', status: response.status });
        }
      }).pipe(
        Effect.scoped,
        Effect.mapError((error) =>
          error._tag === 'CommandRejected' || error._tag === 'ToolCommandRejected'
            ? error
            : toTransportError(error),
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
