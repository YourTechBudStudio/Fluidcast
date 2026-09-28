/**
 * The turn tracker: Claude Code frames and grace timers in, worker events out. Pure.
 *
 * A worker is settled when a result has been seen since the latest turn start, no non-ambient
 * background task is live, and the session is `idle` (the SDK's authoritative turn-over signal).
 * Settling is evaluated only on a result, on `idle` and when a grace timer elapses. When the
 * background set empties after a result, an automatic turn usually starts about 50 ms later, so a
 * grace timer holds the evaluation back; a turn start cancels it, and a timer that is no longer
 * the pending one is rejected by identity.
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { ToolFault } from '@yourtechbudstudio/fluidcast-harness';

import type { WorkerEvent } from '../worker.ts';
import { faultOf, type RateLimit } from './failure.ts';
import { frameEntries } from './transcript.ts';

export interface TurnState {
  readonly session: 'idle' | 'running' | 'requires_action';
  /** Non-ambient background task IDs, replaced on each change. */
  readonly background: ReadonlySet<string>;
  /** A result arrived since the latest turn start. */
  readonly resultSeen: boolean;
  /** The pending grace timer's identity; 0: none. */
  readonly grace: number;
  /** The last grace identity issued, so a new timer never reuses an earlier one's. */
  readonly graces: number;
  /** A rejected rate-limit event in the current turn. */
  readonly rateLimit: RateLimit | undefined;
}

export const initialTurnState: TurnState = {
  session: 'idle',
  background: new Set(),
  resultSeen: false,
  grace: 0,
  graces: 0,
  rateLimit: undefined,
};

export type TrackerInput =
  | { readonly _tag: 'Frame'; readonly frame: SDKMessage }
  | { readonly _tag: 'GraceElapsed'; readonly grace: number };

export type TrackerOutput =
  | WorkerEvent
  | { readonly _tag: 'StartGrace'; readonly grace: number }
  | { readonly _tag: 'CancelGrace' }
  /** Ends the stream: nothing after it is processed. */
  | { readonly _tag: 'Fault'; readonly fault: ToolFault };

type Step = readonly [TurnState, ReadonlyArray<TrackerOutput>];

const cancelGrace = (state: TurnState): Step =>
  state.grace === 0 ? [state, []] : [{ ...state, grace: 0 }, [{ _tag: 'CancelGrace' }]];

const evaluate = (state: TurnState): Step => {
  if (!state.resultSeen || state.background.size > 0 || state.session !== 'idle') {
    return [state, []];
  }
  const [next, outputs] = cancelGrace({ ...state, resultSeen: false });
  return [next, [...outputs, { _tag: 'Settled' }]];
};

const consumedIds = (frame: SDKMessage): ReadonlyArray<string> => {
  if (frame.type !== 'assistant' && frame.type !== 'result') return [];
  if (frame.user_message_uuids !== undefined) return frame.user_message_uuids;
  return frame.user_message_uuid === undefined ? [] : [frame.user_message_uuid];
};

const onFrame = (state: TurnState, frame: SDKMessage): Step => {
  switch (frame.type) {
    case 'result':
      return evaluate({ ...state, resultSeen: true, rateLimit: undefined });
    case 'rate_limit_event':
      return frame.rate_limit_info.status === 'rejected'
        ? [{ ...state, rateLimit: { resetsAt: frame.rate_limit_info.resetsAt } }, []]
        : [state, []];
    case 'system':
      switch (frame.subtype) {
        case 'session_state_changed': {
          if (frame.state === 'running') {
            return cancelGrace({
              ...state,
              session: 'running',
              resultSeen: false,
              rateLimit: undefined,
            });
          }
          const next = { ...state, session: frame.state };
          return frame.state === 'idle' ? evaluate(next) : [next, []];
        }
        case 'background_tasks_changed': {
          const background = new Set(
            frame.tasks.filter((task) => task.ambient !== true).map((task) => task.task_id),
          );
          const next = { ...state, background };
          if (!state.resultSeen || state.background.size === 0 || background.size > 0) {
            return [next, []];
          }
          const grace = state.graces + 1;
          return [{ ...next, grace, graces: grace }, [{ _tag: 'StartGrace', grace }]];
        }
        default:
          return [state, []];
      }
    default:
      return [state, []];
  }
};

/**
 * One input. A frame first yields its transcript entries, then a fault (which ends the stream) or
 * the messages it reports consumed, then whatever its kind changes.
 */
export const step = (state: TurnState, input: TrackerInput): Step => {
  if (input._tag === 'GraceElapsed') {
    return input.grace === 0 || input.grace !== state.grace
      ? [state, []]
      : evaluate({ ...state, grace: 0 });
  }
  const { frame } = input;
  const entries = frameEntries(frame, state.rateLimit).map((entry): TrackerOutput => ({
    _tag: 'Entry',
    entry,
  }));
  const fault = faultOf(frame);
  if (fault !== undefined) return [state, [...entries, { _tag: 'Fault', fault }]];
  const ids = consumedIds(frame);
  const consumed: ReadonlyArray<TrackerOutput> =
    ids.length === 0 ? [] : [{ _tag: 'Consumed', ids }];
  const [next, outputs] = onFrame(state, frame);
  return [next, [...entries, ...consumed, ...outputs]];
};
