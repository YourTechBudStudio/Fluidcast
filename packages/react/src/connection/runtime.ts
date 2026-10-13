import { Effect, Layer } from 'effect';
import { Atom } from 'effect/reactivity';

import * as FluidcastClient from '@yourtechbudstudio/fluidcast-client';

import type { WorkerFeed } from './workerFeed';

/** One backend session's connection, as the host supplies it. */
export type PlayerConnection = Layer.Layer<FluidcastClient.Transport | WorkerFeed>;

/** What an unseeded registry holds: building it dies, naming the misuse. */
const unseeded: PlayerConnection = Layer.unwrap(
  Effect.die(
    new Error(
      'fluidcast-react: the player connection was read outside FluidcastPlayer, which seeds it per instance',
    ),
  ),
);

/**
 * The host's connection for this instance. `FluidcastPlayer` seeds it through its registry's `initialValues`; nothing
 * writes it afterwards. Not `connectionAtom`: that name is the conversation's connection status.
 */
export const connectionLayerAtom = Atom.make<PlayerConnection>(unseeded).pipe(Atom.keepAlive);

/**
 * One Client per player instance, over the host's connection, keeping `WorkerFeed` available to the Worker feeds.
 * Disposing the instance's registry closes this Client's subscription and prefetches and the connection's own
 * resources. Within a registry it stays alive, because a second Client would supersede the subscription.
 */
export const clientRuntime = Atom.keepAlive(
  Atom.runtime((get) => FluidcastClient.layer().pipe(Layer.provideMerge(get(connectionLayerAtom)))),
);
