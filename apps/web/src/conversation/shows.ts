import { Effect, FiberMap, Stream } from 'effect';
import { AsyncResult, Atom, AtomRegistry } from 'effect/unstable/reactivity';

import { Client } from '@yourtechbudstudio/fluidcast-client';
import type { Execution, ExecutionId } from '@yourtechbudstudio/fluidcast-harness/protocol';
import { ShowCommand, showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { clientRuntime } from '../client';
import { renderShow, type ShowBody, type ShownShow } from '../tools';
import { type ReportOutcome, reportActionOf, retryDelay, unseenShows } from './showDriver';
import { connectionAtom, conversationAtom, sendFailureAtom, unresolvedShowsAtom } from './state';
import { findCall, latestShowHandle, showCorrectionOf, showOf } from './tools';

/**
 * Whether the Show panel is open, and on which Show: `handle: null` means the latest. Page-local, and the only
 * client-local tool state: everything else about Shows derives from the view.
 */
export interface ShowPanelState {
  readonly open: boolean;
  readonly handle: string | null;
}

export const showPanelAtom = Atom.make<ShowPanelState>({ open: false, handle: null }).pipe(
  Atom.keepAlive,
);

/** A settled render: what every place showing a Show displays once rendering is done. */
type Settled = Exclude<ShowBody, { readonly state: 'rendering' }>;

/**
 * Each Show call rendered once per page load, shared by the reporter, the panel and the transcript miniatures. A
 * call never changes once in the view, so it is read once.
 */
export const showRenderAtom = Atom.family((handle: string) =>
  Atom.make((get): Effect.Effect<Settled> => {
    const input = showOf(findCall(get.once(conversationAtom), handle));
    if (!input) {
      return Effect.succeed({ state: 'failed', reason: 'This show is not in the conversation.' });
    }
    return renderShow(input).pipe(
      Effect.match({
        onSuccess: (rendered): Settled => ({ state: 'rendered', rendered }),
        onFailure: ({ reason }): Settled => ({ state: 'failed', reason }),
      }),
    );
  }).pipe(Atom.keepAlive),
);

export const bodyOf = (result: AsyncResult.AsyncResult<Settled>): ShowBody =>
  AsyncResult.isSuccess(result) ? result.value : { state: 'rendering' };

/** The Show the panel (or the phone sheet) displays: the one it was opened on, else the latest. */
export const shownShowAtom = Atom.make((get): ShownShow | null => {
  const view = get(conversationAtom);
  const latest = latestShowHandle(view);
  const chosen = get(showPanelAtom).handle;
  const handle = chosen !== null && showOf(findCall(view, chosen)) ? chosen : latest;
  const input = handle === undefined ? undefined : showOf(findCall(view, handle));
  if (handle === undefined || !input) return null;
  const body = bodyOf(get(showRenderAtom(handle)));
  return {
    handle,
    input,
    body,
    correction:
      body.state === 'failed' ? showCorrectionOf(view, handle, get(unresolvedShowsAtom)) : null,
  };
});

const ACCEPTED: ReportOutcome = { _tag: 'Accepted' };

/**
 * The Show driver, mounted by the app for the page's lifetime. It wakes whenever the view or the connection changes
 * (a reconnect snapshot's view arrives before the connection says `connected`, so either can be the only wakeup) and:
 * 1. opens the panel on every Show execution it has not seen, including a replay's new execution after Back;
 * 2. while connected, runs one reporter per open Show execution not yet reported or unresolved;
 * 3. stops the reporters of executions that closed, and all of them when not connected.
 * Reporting never depends on the panel being visible, so closing it cannot stall a turn.
 */
export const showDriverAtom = clientRuntime
  .atom((get) =>
    Effect.gen(function* () {
      const registry = get.registry;
      const client = yield* Client;
      const opened = new Set<ExecutionId>();
      const reported = new Set<ExecutionId>();
      const reporters = yield* FiberMap.make<ExecutionId>();

      const report = (execution: Execution) =>
        Effect.gen(function* () {
          const id = execution.executionId;
          const body = yield* AtomRegistry.getResult(registry, showRenderAtom(execution.handle));
          const payload: ShowCommand =
            body.state === 'rendered' ? { rendered: true } : { failed: body.reason };
          for (let attempt = 0; ; attempt++) {
            const outcome = yield* client
              .sendToolCommand(ShowCommand, execution, payload)
              .pipe(Effect.match({ onSuccess: () => ACCEPTED, onFailure: (error) => error }));
            const action = reportActionOf(outcome);
            switch (action.kind) {
              case 'reported':
                reported.add(id);
                if (action.accepted) registry.set(sendFailureAtom, null);
                return;
              case 'unresolved':
                // An earlier failed attempt no longer explains anything: the status reads out of sync instead.
                registry.set(sendFailureAtom, null);
                registry.set(
                  unresolvedShowsAtom,
                  new Set([...registry.get(unresolvedShowsAtom), id]),
                );
                yield* Effect.logWarning('show report not accepted').pipe(
                  Effect.annotateLogs({ executionId: id }),
                );
                return;
              case 'retry':
                registry.set(sendFailureAtom, action.failure);
                yield* Effect.sleep(retryDelay(attempt));
            }
          }
        });

      const wake = Effect.gen(function* () {
        const view = registry.get(conversationAtom);
        const connected = registry.get(connectionAtom) === 'connected';
        for (const execution of unseenShows(view.executions, opened)) {
          opened.add(execution.executionId);
          registry.set(showPanelAtom, { open: true, handle: execution.handle });
        }
        const shows = view.executions.filter((execution) => execution.tool === showToolName);
        const open = new Set(shows.map((execution) => execution.executionId));
        for (const [id] of [...reporters]) {
          if (!connected || !open.has(id)) yield* FiberMap.remove(reporters, id);
        }
        if (!connected) return;
        const unresolved = registry.get(unresolvedShowsAtom);
        for (const execution of shows) {
          const id = execution.executionId;
          if (reported.has(id) || unresolved.has(id)) continue;
          yield* FiberMap.run(reporters, id, report(execution), { onlyIfMissing: true });
        }
      });

      yield* Stream.merge(
        AtomRegistry.toStream(registry, conversationAtom),
        AtomRegistry.toStream(registry, connectionAtom),
      ).pipe(Stream.runForEach(() => wake));
    }),
  )
  .pipe(Atom.keepAlive);
