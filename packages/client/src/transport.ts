import { Context, Schema, type Effect, type Stream } from 'effect';

import type {
  Command,
  CommandRejected,
  SpeechNotFound,
  SubscriptionMessage,
} from '@yourtechbudstudio/fluidcast-harness/protocol';

/**
 * The connection to the application backend failed. `reason` names the failure (for example a
 * closed connection or a network error) and `status` is the HTTP status where there is one.
 */
export class TransportError extends Schema.TaggedError<TransportError>()('TransportError', {
  reason: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

/**
 * How the client reaches the application backend. Applications implement it over their own
 * transport (ADR 0003); the client never assumes HTTP, SSE or WebSockets.
 */
export class Transport extends Context.Service<
  Transport,
  {
    /**
     * Opens a subscription: a snapshot, then events, possibly ending with `Superseded`. Ending
     * without `Superseded`, or failing, counts as a lost connection and the client reconnects.
     */
    readonly subscribe: () => Stream.Stream<SubscriptionMessage, TransportError>;
    readonly send: (command: Command) => Effect.Effect<void, CommandRejected | TransportError>;
    /** Streams the encoded audio for a speak action. */
    readonly speech: (
      actionId: string,
    ) => Stream.Stream<Uint8Array, SpeechNotFound | TransportError>;
    /**
     * Optional: a URL the application's player can stream the same audio from. When present, audio
     * that is not fully cached is played from it instead of being downloaded first.
     */
    readonly speechUrl?: (actionId: string) => string;
  }
>()('@yourtechbudstudio/fluidcast-client/Transport') {}
