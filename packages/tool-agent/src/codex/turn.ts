/**
 * The turn tracker: `codex app-server` notifications in, worker events out. Pure.
 *
 * A worker is settled when a main-thread `turn/completed` has been seen since the latest
 * main-thread `turn/started`, the main thread's last status is `idle` (or `systemError`, where a
 * failed turn leaves it), and no subagent thread is busy. It is evaluated after every frame,
 * because ordering varies (`idle` arrives just before `turn/completed`). Background commands are
 * not tracked: an entry that arrives once settled (such as a background command's late result) is
 * followed by another `Settled`, since the worker session treats any entry as running.
 *
 * Every thread other than the main one is a subagent: one app-server process hosts only this
 * worker's thread and its descendants. A subagent is busy between its own `turn/started` and
 * `turn/completed`; the item that starts it (a `spawnAgent` call, or a started `subAgentActivity`)
 * marks it busy only while none of its turn frames has been seen, so a child that finished before its spawn item completed is not resurrected.
 */
import type { TranscriptEntry } from '../schema.ts';
import type { WorkerEvent } from '../worker.ts';
import { frameOf, type Frame, type Item, type Notification } from './protocol.ts';
import {
  completedEntries,
  isToolItem,
  planStatus,
  spawnedThreads,
  toolCall,
  toolResult,
  turnEnd,
} from './transcript.ts';

export interface TurnState {
  readonly mainThreadId: string;
  /** The main thread's last status, `systemError` counting as `idle`. */
  readonly mainIdle: boolean;
  /** A main-thread `turn/completed` arrived since the latest main-thread `turn/started`. */
  readonly turnCompleted: boolean;
  /** `Settled` was the last activity reported. */
  readonly settled: boolean;
  /** Subagent threads by ID: busy or not. Present once any of its turn frames or its spawn is seen. */
  readonly subagents: ReadonlyMap<string, boolean>;
  /** Each known subagent thread's starting item (shown as a call). */
  readonly spawnedBy: ReadonlyMap<string, string>;
  /** Tool items whose call was shown on `item/started` and whose result is pending. */
  readonly openCalls: ReadonlySet<string>;
  /** Message IDs already reported consumed. */
  readonly consumed: ReadonlySet<string>;
  /** The reset time of the latest rate-limit snapshot's full window, if any. */
  readonly resetsAt: number | undefined;
}

export const initialTurnState = (mainThreadId: string): TurnState => ({
  mainThreadId,
  mainIdle: true,
  turnCompleted: false,
  settled: false,
  subagents: new Map(),
  spawnedBy: new Map(),
  openCalls: new Set(),
  consumed: new Set(),
  resetsAt: undefined,
});

export type TrackerOutput =
  | WorkerEvent
  /** A main-thread turn completed: a held message may be sent again. */
  | { readonly _tag: 'MainTurnCompleted' };

type Step = readonly [TurnState, ReadonlyArray<TrackerOutput>];

const entry = (value: TranscriptEntry): TrackerOutput => ({ _tag: 'Entry', entry: value });

/**
 * Where a thread's entries nest: the main thread at the top level; a subagent under the item that
 * started it, or, before that item is known, under its own thread ID. Never `null` for a
 * subagent: top-level text becomes the forward result, which a subagent must never write.
 */
const parentOf = (state: TurnState, threadId: string): string | null =>
  threadId === state.mainThreadId ? null : (state.spawnedBy.get(threadId) ?? threadId);

/** Records the subagents an item starts: nesting, and busy while their turns are unseen. */
const noteSpawn = (state: TurnState, item: Item): TurnState => {
  const children = spawnedThreads(item);
  if (children.length === 0) return state;
  const spawnedBy = new Map(state.spawnedBy);
  const subagents = new Map(state.subagents);
  for (const child of children) {
    spawnedBy.set(child, item.id);
    if (!subagents.has(child)) subagents.set(child, true);
  }
  return { ...state, spawnedBy, subagents };
};

const consumedOf = (state: TurnState, threadId: string, item: Item): Step => {
  const id = item.clientId;
  if (
    threadId !== state.mainThreadId ||
    id === undefined ||
    id === null ||
    state.consumed.has(id)
  ) {
    return [state, []];
  }
  return [
    { ...state, consumed: new Set([...state.consumed, id]) },
    [{ _tag: 'Consumed', ids: [id] }],
  ];
};

const onItem = (state: TurnState, threadId: string, item: Item, completed: boolean): Step => {
  if (item.type === 'userMessage') return consumedOf(state, threadId, item);
  const next = noteSpawn(state, item);
  const parent = parentOf(next, threadId);
  if (!isToolItem(item)) {
    return [next, completed ? completedEntries(item, parent, false).map(entry) : []];
  }
  if (!completed) {
    return next.openCalls.has(item.id)
      ? [next, []]
      : [
          { ...next, openCalls: new Set([...next.openCalls, item.id]) },
          [entry(toolCall(item, parent))],
        ];
  }
  const openCalls = new Set(next.openCalls);
  const shown = openCalls.delete(item.id);
  return [
    { ...next, openCalls },
    [...(shown ? [] : [entry(toolCall(item, parent))]), entry(toolResult(item, parent))],
  ];
};

const setSubagent = (state: TurnState, threadId: string, busy: boolean): TurnState => ({
  ...state,
  subagents: new Map(state.subagents).set(threadId, busy),
});

const onFrame = (state: TurnState, frame: Frame): Step => {
  const main = 'threadId' in frame && frame.threadId === state.mainThreadId;
  switch (frame._tag) {
    case 'TurnStarted':
      return main
        ? [{ ...state, turnCompleted: false, settled: false }, []]
        : [{ ...setSubagent(state, frame.threadId, true), settled: false }, []];
    case 'TurnCompleted':
      return main
        ? [
            { ...state, turnCompleted: true },
            [
              entry(turnEnd(frame.status, frame.errorInfo, state.resetsAt)),
              { _tag: 'MainTurnCompleted' },
            ],
          ]
        : [setSubagent(state, frame.threadId, false), []];
    case 'ThreadStatus':
      return main
        ? [{ ...state, mainIdle: frame.status === 'idle' || frame.status === 'systemError' }, []]
        : [state, []];
    case 'ItemStarted':
    case 'ItemCompleted':
      return onItem(state, frame.threadId, frame.item, frame._tag === 'ItemCompleted');
    case 'PlanUpdated':
      return [
        state,
        [
          entry({
            _tag: 'status',
            parentToolUseId: parentOf(state, frame.threadId),
            text: planStatus(frame.explanation, frame.plan),
          }),
        ],
      ];
    case 'RateLimits':
      return [{ ...state, resetsAt: frame.fullResetsAt }, []];
  }
};

const busySubagent = (state: TurnState) => [...state.subagents.values()].some((busy) => busy);

/**
 * One notification: its entries and consumed messages, then `Settled` when it settles the worker,
 * or again when it brought entries to an already settled worker.
 */
export const step = (state: TurnState, notification: Notification): Step => {
  const frame = frameOf(notification.method, notification.params);
  if (frame === undefined) return [state, []];
  const [next, outputs] = onFrame(state, frame);
  const entries = outputs.some((output) => output._tag === 'Entry');
  if (next.settled) return [next, entries ? [...outputs, { _tag: 'Settled' }] : outputs];
  if (next.turnCompleted && next.mainIdle && !busySubagent(next)) {
    return [{ ...next, settled: true }, [...outputs, { _tag: 'Settled' }]];
  }
  return [next, outputs];
};
