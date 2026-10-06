import { Context, Schema, type Effect, type Stream } from 'effect';

import type { SpeechError } from '@yourtechbudstudio/fluidcast-core/speech';
import type {
  Command,
  CommandRejected,
  SpeechNotFound,
  SubscriptionMessage,
  ToolCommandRejected,
} from '@yourtechbudstudio/fluidcast-harness/protocol';

/**
 * Why the backend could not be reached or understood. A closed set, so applications can explain
 * each case instead of showing a generic failure:
 * - `Unreachable`: no response arrived, or the connection broke while reading one;
 * - `Closed`: the subscription ended without `Superseded`;
 * - `BadRequest`: the backend could not accept the request as sent;
 * - `ServerError`: the backend failed while handling the request;
 * - `Malformed`: the backend's reply did not match the protocol.
 */
export const TransportFailure = Schema.Literals([
  'Unreachable',
  'Closed',
  'BadRequest',
  'ServerError',
  'Malformed',
]);
export type TransportFailure = typeof TransportFailure.Type;

/**
 * The connection to the application backend failed. Failures the backend reports in the SDKs' own
 * terms (`CommandRejected`, `ToolCommandRejected`, `SpeechNotFound`, `SpeechError`) are never
 * wrapped in this. `status` is
 * the transport's status code where it has one, for diagnostics.
 */
export class TransportError extends Schema.TaggedError<TransportError>()('TransportError', {
  reason: TransportFailure,
  status: Schema.optional(Schema.Number),
}) {}

/**
 * How the client reaches the application backend. Applications implement it over their own
 * transport (ADR 0001); the client never assumes HTTP, SSE or WebSockets.
 */
export class Transport extends Context.Service<
  Transport,
  {
    /**
     * Opens a subscription: a snapshot, then events, possibly ending with `Superseded`. Ending
     * without `Superseded`, or failing, counts as a lost connection and the client reconnects.
     */
    readonly subscribe: () => Stream.Stream<SubscriptionMessage, TransportError>;
    /** Only a `ToolCommand` can fail with `ToolCommandRejected`. */
    readonly send: (
      command: Command,
    ) => Effect.Effect<void, CommandRejected | ToolCommandRejected | TransportError>;
    /** Streams the encoded audio for a speak action. */
    readonly speech: (
      actionId: string,
    ) => Stream.Stream<Uint8Array, SpeechNotFound | SpeechError | TransportError>;
    /**
     * Optional: a URL the application's player can stream the same audio from. When present, audio
     * that is not fully cached is played from it instead of being downloaded first.
     */
    readonly speechUrl?: (actionId: string) => string;
  }
>()('@yourtechbudstudio/fluidcast-client/Transport') {}
