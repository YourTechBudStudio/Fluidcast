import { Context, Effect, Layer, type Option } from 'effect';

import type {
  CommandRejected,
  PlaybackId,
  SpeechNotFound,
} from '@yourtechbudstudio/fluidcast-harness/protocol';

import { makeAudio, memoryStore, type AudioStore, type Playable } from './audio/index.ts';
import {
  makeSession,
  type Connection,
  type ConversationView,
  type PlaybackInstruction,
  type Subscribable,
} from './session/index.ts';
import { Transport, type TransportError } from './transport.ts';

/**
 * The Client SDK: a projection of the Harness session plus audio prefetching and caching. The
 * application supplies the `Transport` and plays the instructions.
 */
export class Client extends Context.Service<
  Client,
  {
    /** The actions up to the cursor and the phase. `None` until the first snapshot. */
    readonly view: Subscribable<Option.Option<ConversationView>>;
    readonly connection: Subscribable<Connection>;
    /**
     * The line to play now. It becomes `None` when the Harness moves on (finished, interrupted),
     * and on reconnect or supersede, so the application stops playing.
     */
    readonly playback: Subscribable<Option.Option<PlaybackInstruction>>;
    readonly sendMessage: (text: string) => Effect.Effect<void, CommandRejected | TransportError>;
    readonly interrupt: () => Effect.Effect<void, CommandRejected | TransportError>;
    /** Retries a failed generation. */
    readonly retry: () => Effect.Effect<void, CommandRejected | TransportError>;
    /** Reports that the instruction with this `playbackId` finished playing. */
    readonly finished: (
      playbackId: PlaybackId,
    ) => Effect.Effect<void, CommandRejected | TransportError>;
    /** Fresh audio for a speak in the view, for retrying a clip that failed to play. */
    readonly playable: (
      actionId: string,
    ) => Effect.Effect<Playable, SpeechNotFound | TransportError>;
  }
>()('@yourtechbudstudio/fluidcast-client/Client') {}

export interface ClientOptions {
  /** Where downloaded audio is kept. Defaults to memory. */
  readonly store?: AudioStore;
}

/** The client as a Layer over the application's `Transport`. It stays connected while the Layer lives. */
export const layer = (options: ClientOptions = {}): Layer.Layer<Client, never, Transport> =>
  Layer.effect(
    Client,
    Effect.gen(function* () {
      const transport = yield* Transport;
      const audio = yield* makeAudio(transport, options.store ?? memoryStore());
      return yield* makeSession(transport, audio);
    }),
  );
