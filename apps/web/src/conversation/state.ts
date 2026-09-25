import { useAtomSet } from '@effect/atom-react';
import { Effect, Option, Stream } from 'effect';
import { AsyncResult, Atom } from 'effect/unstable/reactivity';
import { useMemo } from 'react';

import { Client, type TransportError } from '@yourtechbudstudio/fluidcast-client';
import type { CommandRejected } from '@yourtechbudstudio/fluidcast-harness/protocol';

import { clientRuntime } from '../client';
import { playbackAtom } from '../playback';
import type { Connection, ConversationCommands, ConversationView } from './model';
import { present } from './presentation';

const EMPTY: ConversationView = { actions: [], phase: 'idle', speakers: [] };

const viewResultAtom = clientRuntime.atom(
  Stream.unwrap(Effect.map(Effect.service(Client), (client) => client.view.changes)),
);
const connectionResultAtom = clientRuntime.atom(
  Stream.unwrap(Effect.map(Effect.service(Client), (client) => client.connection.changes)),
);

/** The projected conversation: the Client SDK's view. Empty until the first snapshot, while the connection says `connecting`. */
export const conversationAtom = Atom.make((get) =>
  get(viewResultAtom).pipe(
    AsyncResult.value,
    Option.flatten,
    Option.getOrElse(() => EMPTY),
  ),
);

export const connectionAtom = Atom.make((get): Connection =>
  get(connectionResultAtom).pipe(
    AsyncResult.value,
    Option.getOrElse((): Connection => 'connecting'),
  ),
);

const phaseAtom = Atom.make((get) => get(conversationAtom).phase);

/**
 * A command could not reach the backend. Client-local, like playback status: it is recomputed, and so
 * cleared, whenever the phase or the connection changes, and a successful command clears it too.
 */
export const sendFailedAtom = Atom.writable(
  (get) => {
    get(phaseAtom);
    get(connectionAtom);
    return false;
  },
  (ctx, failed: boolean) => ctx.setSelf(failed),
).pipe(Atom.keepAlive);

/**
 * Runs a command and reports whether the Harness accepted it. A rejection means the view was briefly
 * stale: the subscription is already bringing the true phase, so it is only logged. A transport failure
 * is shown in the status line.
 */
const accepted = (
  get: Atom.FnContext,
  run: (client: Client['Service']) => Effect.Effect<void, CommandRejected | TransportError>,
) =>
  Effect.flatMap(Effect.service(Client), run).pipe(
    Effect.tap(() => Effect.sync(() => get.set(sendFailedAtom, false))),
    Effect.as(true),
    Effect.catchTags({
      CommandRejected: (error: CommandRejected) =>
        Effect.logWarning('command rejected').pipe(
          Effect.annotateLogs({ command: error.command, phase: error.phase }),
          Effect.as(false),
        ),
      TransportError: (error: TransportError) =>
        Effect.sync(() => get.set(sendFailedAtom, true)).pipe(
          Effect.andThen(Effect.logWarning('command failed')),
          Effect.annotateLogs({ reason: error.reason, status: error.status }),
          Effect.as(false),
        ),
    }),
  );

const sendMessageAtom = clientRuntime.fn((text: string, get) =>
  accepted(get, (client) => client.sendMessage(text)),
);
const interruptAtom = clientRuntime.fn((_: void, get) =>
  accepted(get, (client) => client.interrupt()),
);
const retryGenerationAtom = clientRuntime.fn((_: void, get) =>
  accepted(get, (client) => client.retry()),
);

/** The commands the UI sends. Each resolves `true` once the Harness accepted it. */
export function useConversationCommands(): ConversationCommands {
  const sendMessage = useAtomSet(sendMessageAtom, { mode: 'promise' });
  const interrupt = useAtomSet(interruptAtom, { mode: 'promise' });
  const retryGeneration = useAtomSet(retryGenerationAtom, { mode: 'promise' });
  return useMemo(
    () => ({
      sendMessage,
      interrupt: () => interrupt(),
      retryGeneration: () => retryGeneration(),
    }),
    [sendMessage, interrupt, retryGeneration],
  );
}

/** Everything the player shows, derived from the conversation, the connection, playback and a failed send. */
export const presentationAtom = Atom.make((get) =>
  present(get(conversationAtom), get(connectionAtom), get(playbackAtom), get(sendFailedAtom)),
);
