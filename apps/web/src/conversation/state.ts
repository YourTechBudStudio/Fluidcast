import { useAtomSet } from '@effect/atom-react';
import { Effect, Option, Stream } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { AsyncResult, Atom } from 'effect/unstable/reactivity';
import { useMemo } from 'react';

import { Client, type TransportError } from '@yourtechbudstudio/fluidcast-client';
import type {
  CommandRejected,
  Execution,
  ExecutionId,
  ToolCommandRejected,
} from '@yourtechbudstudio/fluidcast-harness/protocol';
import { AskCommand } from '@yourtechbudstudio/fluidcast-tool-ask/schema';

import { clientRuntime, resetSession, sessionIdAtom } from '../client';
import { playbackAtom } from '../playback';
import type { Connection, ConversationCommands, ConversationView } from './model';
import { present, resetPendingOf } from './presentation';

const EMPTY: ConversationView = {
  actions: [],
  phase: 'idle',
  frontierPhase: 'idle',
  paused: false,
  controls: { back: false, next: false, play: false, pause: false, send: false },
  speakers: [],
  executions: [],
  pendingResults: [],
  start: null,
  presented: undefined,
};

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
 * Why the last command could not reach the backend, if it could not. Client-local, like playback status: it is
 * recomputed, and so cleared, whenever the phase or the connection changes, and a successful command clears it too.
 */
export const sendFailureAtom = Atom.writable(
  (get): TransportError | null => {
    get(phaseAtom);
    get(connectionAtom);
    return null;
  },
  (ctx, failure: TransportError | null) => ctx.setSelf(failure),
).pipe(Atom.keepAlive);

/**
 * Why the last Reset was not confirmed, if it was not. Like `sendFailureAtom`, a change in the phase or the connection
 * clears it, and pressing Reset again does too.
 */
const resetFailureAtom = Atom.writable(
  (get): TransportError | null => {
    get(phaseAtom);
    get(connectionAtom);
    return null;
  },
  (ctx, failure: TransportError | null) => ctx.setSelf(failure),
).pipe(Atom.keepAlive);

/**
 * Ends this registry's backend session. Resolves `true` once the backend confirmed it; the page leaves the session only
 * when the status stream reports it, which disposes this registry. Pressing Reset again after a failure is the retry.
 */
const resetAtom = Atom.fn((_: void, get) =>
  Effect.sync(() => get.set(resetFailureAtom, null)).pipe(
    Effect.andThen(resetSession(get(sessionIdAtom))),
    Effect.provide(FetchHttpClient.layer),
    Effect.as(true),
    Effect.catchTag('TransportError', (error) =>
      Effect.sync(() => get.set(resetFailureAtom, error)).pipe(
        Effect.andThen(Effect.logWarning('reset failed')),
        Effect.annotateLogs({ reason: error.reason, status: error.status }),
        Effect.as(false),
      ),
    ),
  ),
);

/** Reset is in flight, or succeeded and the page is about to leave the session. */
const resetPendingAtom = Atom.make((get) => resetPendingOf(get(resetAtom)));

/**
 * Show executions whose report the Harness would not accept (`invalid`): the page and the backend disagree, so this
 * page does not report them again. Page-local: the status line says the two are out of sync for as long as such an
 * execution stays open, and a reload starts afresh. Written only by the Show driver.
 */
export const unresolvedShowsAtom = Atom.make(
  new Set<ExecutionId>() as ReadonlySet<ExecutionId>,
).pipe(Atom.keepAlive);

/**
 * Runs a command and reports whether the Harness accepted it. A rejection means the view was briefly
 * stale: the subscription is already bringing the true phase, so it is only logged. A transport failure
 * is shown in the status line.
 */
const accepted = (
  get: Atom.FnContext,
  run: (
    client: Client['Service'],
  ) => Effect.Effect<void, CommandRejected | ToolCommandRejected | TransportError>,
) =>
  Effect.flatMap(Effect.service(Client), run).pipe(
    Effect.tap(() => Effect.sync(() => get.set(sendFailureAtom, null))),
    Effect.as(true),
    Effect.catchTags({
      CommandRejected: (error: CommandRejected) =>
        Effect.logWarning('command rejected').pipe(
          Effect.annotateLogs({ command: error.command, phase: error.phase }),
          Effect.as(false),
        ),
      ToolCommandRejected: (error: ToolCommandRejected) =>
        Effect.logWarning('tool command rejected').pipe(
          Effect.annotateLogs({ executionId: error.executionId, reason: error.reason }),
          Effect.as(false),
        ),
      TransportError: (error: TransportError) =>
        Effect.sync(() => get.set(sendFailureAtom, error)).pipe(
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
const answerAskAtom = clientRuntime.fn(
  (
    {
      execution,
      answer,
    }: {
      readonly execution: Execution;
      readonly answer: AskCommand;
    },
    get,
  ) =>
    accepted(get, (client) =>
      // Commands name the execution's opening call.
      client.sendToolCommand(
        AskCommand,
        { handle: execution.handles[0], executionId: execution.executionId },
        answer,
      ),
    ),
);
const backAtom = clientRuntime.fn((_: void, get) => accepted(get, (client) => client.back()));
const startAtom = clientRuntime.fn((_: void, get) => accepted(get, (client) => client.start()));

/** The commands the UI sends. Each resolves `true` once the Harness accepted it. */
export function useConversationCommands(): ConversationCommands {
  const sendMessage = useAtomSet(sendMessageAtom, { mode: 'promise' });
  const interrupt = useAtomSet(interruptAtom, { mode: 'promise' });
  const retryGeneration = useAtomSet(retryGenerationAtom, { mode: 'promise' });
  const answerAsk = useAtomSet(answerAskAtom, { mode: 'promise' });
  const back = useAtomSet(backAtom, { mode: 'promise' });
  const start = useAtomSet(startAtom, { mode: 'promise' });
  const reset = useAtomSet(resetAtom, { mode: 'promise' });
  return useMemo(
    () => ({
      sendMessage,
      interrupt: () => interrupt(),
      retryGeneration: () => retryGeneration(),
      answerAsk: (execution, answer) => answerAsk({ execution, answer }),
      back: () => back(),
      start: () => start(),
      reset: () => reset(),
    }),
    [sendMessage, interrupt, retryGeneration, answerAsk, back, start, reset],
  );
}

/**
 * Everything the player shows, derived from the conversation, the connection, playback, a failed send, Show reports
 * the Harness would not accept, and Reset.
 */
export const presentationAtom = Atom.make((get) =>
  present(
    get(conversationAtom),
    get(connectionAtom),
    get(playbackAtom),
    get(sendFailureAtom),
    get(unresolvedShowsAtom),
    { pending: get(resetPendingAtom), failure: get(resetFailureAtom) },
  ),
);
