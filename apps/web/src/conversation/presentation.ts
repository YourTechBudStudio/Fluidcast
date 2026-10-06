import { absurd } from 'effect/Function';
import { AsyncResult } from 'effect/unstable/reactivity';

import type { TransportError } from '@yourtechbudstudio/fluidcast-client';
import type { Execution, ExecutionId } from '@yourtechbudstudio/fluidcast-harness/protocol';
import { forwardErrorParts, forwardToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import type { AskCommand, AskInput } from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import type { ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import type { PlaybackFailure, PlaybackStatus, SubtitleLine } from '../playback';
import type { AskCardState, Correction } from '../tools';
import type { VisualState } from '../visuals';
import type { Action, Connection, ConversationView, Speaker } from './model';
import {
  answerFor,
  askOf,
  findCall,
  forwardResultOf,
  forwardThinkingSince,
  isForward,
  latestShowHandle,
  openAsk,
  pendingAnswer,
  showOf,
  toolErrorOf,
  turnBoundary,
} from './tools';

/**
 * The moment the player is in. One value decides the status copy, the composer, the visual and part of the subtitle, so
 * those can never disagree.
 */
export type Moment =
  | 'ready'
  | 'connecting'
  | 'reconnecting'
  | 'superseded'
  | 'held'
  | 'audioFailed'
  | 'generationFailed'
  | 'halted'
  | 'speaking'
  | 'asking'
  | 'thinking'
  | 'waiting'
  | 'fresh'
  | 'complete'
  | 'interrupted';

/**
 * A failure the status line explains by its cause, so the listener learns what went wrong rather than only that
 * something did:
 * - `audioMissing`: the line is no longer in the conversation (`SpeechNotFound`);
 * - `voiceFailed`: the speech provider could not voice the line (`SpeechError`);
 * - `audioUnreachable` / `sendUnreachable`: the backend could not be reached;
 * - `audioUnplayable`: the browser could not play a clip it had fully received;
 * - `audioStreamFailed`: a streamed clip failed, and the browser does not say whether the network, the backend or
 *   the clip was at fault;
 * - `serverFailed`: the backend failed while handling the request;
 * - `outOfSync`: the backend could not accept the request, or replied outside the protocol.
 */
export type FailureStatus =
  | 'audioMissing'
  | 'voiceFailed'
  | 'audioUnreachable'
  | 'audioUnplayable'
  | 'audioStreamFailed'
  | 'sendUnreachable'
  | 'serverFailed'
  | 'outOfSync';

/**
 * What the status line speaks to: the moment, with an audio failure refined to its cause, or a command that could
 * not reach the backend. A failed send changes nothing else, because the conversation did not change; connection
 * moments still take priority. One refinement only changes the copy: `askingText`, `asking` for a question answered
 * in the listener's own words.
 *
 * Reset adds two: `resetting` while a Reset is pending or has succeeded (the session is ending, so it wins even over
 * the connection dropping as a result), and `resetFailed` when the backend did not confirm one.
 */
export type StatusMoment =
  | Exclude<Moment, 'audioFailed'>
  | FailureStatus
  | 'askingText'
  | 'resetting'
  | 'resetFailed';

/**
 * Reset as the player shows it. `pending` holds from the press until the registry is disposed: while the request runs,
 * and after it succeeded, until the status stream takes the page back to the mode screen.
 */
export interface ResetState {
  readonly pending: boolean;
  readonly failure: TransportError | null;
}

/**
 * Whether a Reset is pending, from its request's result (`true` once the backend confirmed it): while the request runs,
 * and after it succeeded. A confirmed Reset always ends in the registry's disposal, so it never needs clearing.
 */
export const resetPendingOf = (result: AsyncResult.AsyncResult<boolean, unknown>): boolean =>
  result.waiting || (AsyncResult.isSuccess(result) && result.value);

/** Which controls the composer offers. */
export type ComposerMode = 'compose' | 'busy' | 'retry' | 'retryClip' | 'offline';

export type TimelineRow =
  | { readonly kind: 'user'; readonly id: string; readonly text: string }
  /**
   * A preloaded start waiting for Tap to start: its message, and the label of the context sent with it. The context's
   * text is for the model only. After the tap, the message is an ordinary `user` row with the same ID.
   */
  | {
      readonly kind: 'preloaded';
      readonly id: string;
      readonly text: string;
      readonly contextLabel: string | null;
    }
  | {
      readonly kind: 'speak';
      readonly id: string;
      readonly speaker: Speaker;
      readonly tone: number;
      readonly text: string;
      /** Same speaker as the previous row: drawn as a continuation. */
      readonly continued: boolean;
      /** The next action interrupted this line while it played. */
      readonly interrupted: boolean;
      /** Set on the line at the cursor. */
      readonly now: 'playing' | 'audioFailed' | 'held' | 'queued' | null;
    }
  /** `speech`: a playing line was cut. `wait`: the listener cut in while nothing played. */
  | { readonly kind: 'interrupted'; readonly id: string; readonly during: 'speech' | 'wait' }
  | { readonly kind: 'failed'; readonly id: string; readonly tag: string; readonly message: string }
  | {
      readonly kind: 'show';
      readonly id: string;
      readonly handle: string;
      readonly input: ShowInput;
      /** Why it did not render, once its error is known (submitted or pending). */
      readonly failure: string | null;
      /** The previous Show failed, and this one replaced it. */
      readonly corrects: boolean;
    }
  | {
      readonly kind: 'ask';
      readonly id: string;
      readonly handle: string;
      readonly input: AskInput;
      readonly answer: AskCommand | null;
      readonly state: AskCardState;
    }
  | {
      /** A tool call that is valid for no tool: its error goes back to the model. */
      readonly kind: 'invalidCall';
      readonly id: string;
      readonly handle: string;
      readonly tool: string;
      readonly error: string | null;
      /**
       * `sent` once the model has read the error; `pending` while it waits to be submitted; `null` before the cursor
       * reaches the call, and for a pending error after a halt, because nothing is submitted after a halt.
       */
      readonly correction: Correction;
    }
  | {
      /** The listener's words forwarded to the worker. */
      readonly kind: 'forward';
      readonly id: string;
      readonly handle: string;
      /**
       * `working` while an open execution holds the call; `answered` or `failed` once an outcome that includes it is
       * known (submitted or pending); `null` otherwise, for example after a halt.
       */
      readonly state: 'working' | 'answered' | 'failed' | null;
      /** The call joined the busy worker's execution, so it steered the current work. */
      readonly joined: boolean;
      /** The other calls the same execution or outcome answers. */
      readonly together: readonly string[];
    }
  | {
      /** What the model read back from the worker, at the position in the log where it read it. */
      readonly kind: 'forwardResult';
      readonly id: string;
      readonly handles: readonly string[];
      readonly outcome:
        | { readonly _tag: 'result'; readonly messages: readonly string[] }
        | { readonly _tag: 'error'; readonly error: string; readonly written: string | null };
    }
  /** The worker's progress, as the model read it. */
  | { readonly kind: 'progress'; readonly id: string; readonly text: string }
  | { readonly kind: 'faulted'; readonly id: string; readonly message: string }
  | { readonly kind: 'pending'; readonly label: string };

/**
 * The question in place of the composer: `open` while its execution waits for an answer; `sent` while the answer
 * waits for narration or the continuation to take it to the model.
 */
export type AskPresence =
  | { readonly mode: 'open'; readonly execution: Execution; readonly input: AskInput }
  | {
      readonly mode: 'sent';
      readonly handle: string;
      readonly input: AskInput;
      readonly answer: AskCommand;
    };

export interface Presentation {
  readonly moment: Moment;
  readonly status: StatusMoment;
  readonly composer: ComposerMode;
  readonly visual: VisualState;
  /** Playback waits for a gesture; the visual dims. */
  readonly held: boolean;
  readonly subtitle: SubtitleLine | null;
  readonly timeline: readonly TimelineRow[];
  readonly ask: AskPresence | null;
  /**
   * Esc and Interrupt act: something is playing or on its way, or a question is open. Interrupting an
   * open question closes it unanswered, as the Ask card's Interrupt does.
   */
  readonly interruptible: boolean;
  /** An earlier line can be presented again. */
  readonly canGoBack: boolean;
  /** Why a tool halted the conversation, if one did. */
  readonly fault: string | null;
  /** The Show the Show button opens, if there has been one. */
  readonly latestShow: string | null;
  /** A Reset is pending or succeeded: Reset and Tap to start do nothing until the page leaves the session. */
  readonly resetPending: boolean;
  /**
   * While thinking, when the open Forward execution started (epoch milliseconds), so the status line counts the whole
   * time the worker has been busy; `null` when the worker is not running or the moment is not `thinking`.
   */
  readonly thinkingSince: number | null;
}

const lastIndexWhere = <A>(items: readonly A[], f: (a: A) => boolean) => {
  for (let i = items.length - 1; i >= 0; i--) if (f(items[i]!)) return i;
  return -1;
};

const isSpeak = (action: Action): action is Extract<Action, { type: 'speak' }> =>
  action.type === 'speak';

/** Whether the action at `index` is a line an interrupt cut while it played. */
const cutAt = (view: ConversationView, index: number) => {
  const next = view.actions[index + 1];
  return next?.type === 'interrupted' && next.during === 'speech';
};

/** Where the presented speak sits in the view; the end when nothing is presented. */
const presentedIndex = (view: ConversationView) =>
  view.presented
    ? view.actions.findIndex((action) => action.id === view.presented!.id)
    : view.actions.length;

/**
 * Playback status only counts for the speak being presented: at the cursor, or at the replay position after Back. A
 * status for any other action, such as a late failure for a line that was interrupted, is stale and ignored by
 * identity (ADR 0001).
 */
function playbackAtPresented(
  view: ConversationView,
  playback: PlaybackStatus,
): PlaybackStatus['kind'] {
  if (playback.kind === 'idle' || view.phase !== 'speaking') return 'idle';
  return view.presented?.id === playback.actionId ? playback.kind : 'idle';
}

export function momentOf(
  view: ConversationView,
  connection: Connection,
  playback: PlaybackStatus,
): Moment {
  if (connection !== 'connected') return connection;
  const presented = playbackAtPresented(view, playback);
  if (presented === 'held') return 'held';
  if (presented === 'failed') return 'audioFailed';
  switch (view.phase) {
    // A preloaded start waits for Tap to start.
    case 'ready':
      return 'ready';
    case 'generationFailed':
      return 'generationFailed';
    // A tool fault stopped the conversation for good.
    case 'halted':
      return 'halted';
    case 'speaking':
      return 'speaking';
    // A blocking tool holds the turn for the listener.
    case 'waiting':
      return 'asking';
    case 'working':
      // While the worker runs, the system is thinking, whatever else goes on around it.
      if (view.executions.some((execution) => execution.tool === forwardToolName))
        return 'thinking';
      // A continuation starts a new model turn too: until it speaks, the model is thinking.
      return view.actions.slice(turnBoundary(view) + 1).some(isSpeak) ? 'waiting' : 'thinking';
    case 'idle': {
      const last = view.actions.at(-1);
      if (!last) return 'fresh';
      return last.type === 'interrupted' ? 'interrupted' : 'complete';
    }
  }
}

const COMPOSER: Record<Moment, ComposerMode> = {
  ready: 'offline',
  connecting: 'offline',
  reconnecting: 'offline',
  superseded: 'offline',
  held: 'busy',
  audioFailed: 'retryClip',
  generationFailed: 'retry',
  halted: 'offline',
  speaking: 'busy',
  asking: 'busy',
  thinking: 'busy',
  waiting: 'busy',
  fresh: 'compose',
  complete: 'compose',
  interrupted: 'compose',
};

const VISUAL: Record<Moment, VisualState> = {
  ready: 'idle',
  connecting: 'offline',
  reconnecting: 'offline',
  superseded: 'offline',
  held: 'speaking',
  audioFailed: 'error',
  generationFailed: 'error',
  halted: 'error',
  speaking: 'speaking',
  asking: 'idle',
  thinking: 'thinking',
  waiting: 'thinking',
  fresh: 'idle',
  complete: 'idle',
  interrupted: 'idle',
};

/** Speaker accent tones, in configuration order. */
export const SPEAKER_TONES = ['blue', 'green', 'amber', 'violet'] as const;

function speakerOf(view: ConversationView, id: string): { speaker: Speaker; tone: number } {
  const index = view.speakers.findIndex((s) => s.id === id);
  return {
    speaker: view.speakers[index] ?? { id, name: id },
    tone: Math.max(0, index) % SPEAKER_TONES.length,
  };
}

function yourLine(view: ConversationView): SubtitleLine | null {
  const lastUser = view.actions.findLast((a) => a.type === 'user_message');
  return lastUser ? { key: lastUser.id, text: lastUser.text, tone: 'you', label: 'You' } : null;
}

function subtitleOf(
  view: ConversationView,
  moment: Moment,
  playback: PlaybackStatus,
): SubtitleLine | null {
  const multi = view.speakers.length > 1;
  const line = (
    action: Extract<Action, { type: 'speak' }>,
    tone: SubtitleLine['tone'],
    interrupted = false,
  ): SubtitleLine => ({
    key: action.id,
    text: action.text,
    tone,
    interrupted,
    ...(multi ? { label: speakerOf(view, action.speaker).speaker.name } : {}),
  });
  const lastSpeakIndex = lastIndexWhere(view.actions, isSpeak);
  const lastSpeak = view.actions[lastSpeakIndex] as Extract<Action, { type: 'speak' }> | undefined;

  switch (moment) {
    case 'connecting':
    case 'superseded':
    case 'held':
    case 'fresh':
      return null;
    case 'ready': {
      // The preloaded message, under Tap to start. After the tap, your just-sent message takes over.
      const message = view.start?.message;
      return message
        ? {
            key: `preloaded:${message.id}`,
            text: `“${message.text}”`,
            tone: 'you',
            label: 'Preloaded · Tap to start says',
          }
        : null;
    }
    case 'speaking': {
      // A line appears when its audio starts. Until then the previous line of this turn stays, or your own message if
      // none has played yet. After Back, the presented line is an earlier one.
      const presented = view.presented;
      if (presented && playback.kind === 'playing' && playback.actionId === presented.id)
        return line(presented, 'current');
      const before = view.actions.slice(0, presentedIndex(view));
      const turnStart = lastIndexWhere(before, (a) => a.type === 'user_message');
      const earlier = before.slice(turnStart + 1).findLast(isSpeak);
      return earlier ? line(earlier, 'current') : yourLine(view);
    }
    case 'thinking': {
      // A line said in this turn (while the worker runs) stays, dimmed. Otherwise thinking about your message shows it,
      // and thinking about a tool's outcome keeps the last line.
      const boundary = turnBoundary(view);
      if (lastSpeakIndex > boundary && lastSpeak) return line(lastSpeak, 'dim');
      return view.actions[boundary]?.type === 'user_message'
        ? yourLine(view)
        : lastSpeak
          ? line(lastSpeak, 'dim')
          : null;
    }
    case 'waiting':
      return lastSpeak ? line(lastSpeak, 'current') : null;
    case 'interrupted':
      return lastSpeak ? line(lastSpeak, 'dim', cutAt(view, lastSpeakIndex)) : null;
    default:
      return lastSpeak ? line(lastSpeak, 'dim') : null;
  }
}

function askStateOf(
  view: ConversationView,
  handle: string,
  answer: { readonly pending: boolean } | undefined,
): AskCardState {
  if (answer) return answer.pending ? 'pending' : 'answered';
  return view.executions.some((e) => e.handles.includes(handle)) ? 'live' : 'unanswered';
}

type Outcome = Extract<Action, { type: 'tool_result' | 'tool_errored' }>;

/** Where a forward call stands, and which other calls share its execution or outcome. */
function forwardStateOf(
  view: ConversationView,
  handle: string,
): Pick<Extract<TimelineRow, { kind: 'forward' }>, 'state' | 'joined' | 'together'> {
  const holds = (group: { readonly handles: readonly string[] }) => group.handles.includes(handle);
  const execution = view.executions.find(holds);
  const outcome = [...view.actions, ...view.pendingResults].find(
    (action): action is Outcome =>
      (action.type === 'tool_result' || action.type === 'tool_errored') && holds(action),
  );
  const state = execution
    ? 'working'
    : outcome?.type === 'tool_result'
      ? 'answered'
      : outcome?.type === 'tool_errored'
        ? 'failed'
        : null;
  const handles = (execution ?? outcome)?.handles ?? [handle];
  return {
    state,
    joined: handles[0] !== handle,
    together: handles.filter((other) => other !== handle),
  };
}

/** The row for a forward outcome. */
function forwardResultRowOf(
  outcome: Outcome,
): Extract<TimelineRow, { kind: 'forwardResult' }> | null {
  if (outcome.tool !== forwardToolName) return null;
  return {
    kind: 'forwardResult',
    id: outcome.id,
    handles: outcome.handles,
    outcome:
      outcome.type === 'tool_result'
        ? { _tag: 'result', messages: forwardResultOf(outcome) }
        : { _tag: 'error', ...forwardErrorParts(outcome.message) },
  };
}

function timelineOf(
  view: ConversationView,
  moment: Moment,
  playback: PlaybackStatus,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const halted = view.phase === 'halted';
  // Whether the most recent Show so far failed, so the next one is its correction.
  let showFailed = false;
  view.actions.forEach((action, i) => {
    switch (action.type) {
      case 'user_message':
        rows.push({ kind: 'user', id: action.id, text: action.text });
        break;
      case 'speak': {
        const previous = view.actions[i - 1];
        const { speaker, tone } = speakerOf(view, action.speaker);
        let now: Extract<TimelineRow, { kind: 'speak' }>['now'] = null;
        if (action.id === view.presented?.id) {
          const presented = playbackAtPresented(view, playback);
          now =
            presented === 'idle' ? 'queued' : presented === 'failed' ? 'audioFailed' : presented;
        }
        rows.push({
          kind: 'speak',
          id: action.id,
          speaker,
          tone,
          text: action.text,
          continued: previous?.type === 'speak' && previous.speaker === action.speaker,
          interrupted: cutAt(view, i),
          now,
        });
        break;
      }
      case 'tool_call': {
        const show = showOf(action);
        if (show) {
          const failure = toolErrorOf(view, action.handle)?.message ?? null;
          rows.push({
            kind: 'show',
            id: action.id,
            handle: action.handle,
            input: show,
            failure,
            corrects: showFailed,
          });
          showFailed = failure !== null;
          break;
        }
        if (isForward(action)) {
          rows.push({
            kind: 'forward',
            id: action.id,
            handle: action.handle,
            ...forwardStateOf(view, action.handle),
          });
          break;
        }
        const ask = askOf(action);
        if (ask) {
          const answer = answerFor(view, action.handle);
          rows.push({
            kind: 'ask',
            id: action.id,
            handle: action.handle,
            input: ask,
            answer: answer?.answer ?? null,
            state: askStateOf(view, action.handle, answer),
          });
          break;
        }
        const error = toolErrorOf(view, action.handle);
        rows.push({
          kind: 'invalidCall',
          id: action.id,
          handle: action.handle,
          tool: action.tool,
          error: error?.message ?? null,
          correction: error?.submitted ? 'sent' : error && !halted ? 'pending' : null,
        });
        break;
      }
      // A forward outcome has its own row where the model read it; other outcomes belong to their call's row.
      case 'tool_result':
      case 'tool_errored': {
        const row = forwardResultRowOf(action);
        if (row) rows.push(row);
        break;
      }
      case 'tool_progress': {
        // Only the Forward tool reports progress.
        if (isForward(findCall(view, action.handles[0])))
          rows.push({ kind: 'progress', id: action.id, text: action.text });
        break;
      }
      // Context is for the model only.
      case 'context':
      case 'tool_context':
        break;
      case 'tool_faulted':
        rows.push({ kind: 'faulted', id: action.id, message: action.error.message });
        break;
      case 'interrupted':
        rows.push({ kind: 'interrupted', id: action.id, during: action.during });
        break;
      case 'generation_failed':
        rows.push({
          kind: 'failed',
          id: action.id,
          tag: action.error.tag,
          message: action.error.message,
        });
        break;
      default:
        absurd(action);
    }
  });
  if (view.start !== null)
    rows.push({
      kind: 'preloaded',
      id: view.start.message.id,
      text: view.start.message.text,
      contextLabel: view.start.context?.label ?? null,
    });
  if (moment === 'thinking') rows.push({ kind: 'pending', label: 'Thinking…' });
  if (moment === 'waiting') rows.push({ kind: 'pending', label: 'More on the way…' });
  return rows;
}

function transportStatus(error: TransportError, unreachable: FailureStatus): FailureStatus {
  switch (error.reason) {
    case 'Unreachable':
    case 'Closed':
      return unreachable;
    case 'ServerError':
      return 'serverFailed';
    case 'BadRequest':
    case 'Malformed':
      return 'outOfSync';
  }
}

function audioStatus(error: PlaybackFailure): FailureStatus {
  switch (error._tag) {
    case 'SpeechNotFound':
      return 'audioMissing';
    case 'SpeechError':
      return 'voiceFailed';
    case 'MediaError':
      return error.streamed ? 'audioStreamFailed' : 'audioUnplayable';
    case 'TransportError':
      return transportStatus(error, 'audioUnreachable');
  }
}

function statusOf(
  view: ConversationView,
  moment: Moment,
  connection: Connection,
  playback: PlaybackStatus,
  sendFailure: TransportError | null,
  unresolvedShows: ReadonlySet<ExecutionId>,
  reset: ResetState,
): StatusMoment {
  // The session is ending at the listener's request: a connection dropping now is that, not a fault.
  if (reset.pending) return 'resetting';
  if (connection === 'connected') {
    if (reset.failure) return 'resetFailed';
    if (sendFailure) return transportStatus(sendFailure, 'sendUnreachable');
    // A Show report the Harness would not accept: out of sync for as long as that execution stays open.
    if (view.executions.some((e) => unresolvedShows.has(e.executionId))) return 'outOfSync';
  }
  switch (moment) {
    case 'audioFailed':
      // `audioFailed` is only ever derived from a failed playback status.
      return playback.kind === 'failed' ? audioStatus(playback.error) : 'audioUnplayable';
    case 'asking':
      return openAsk(view)?.input.kind === 'text' ? 'askingText' : 'asking';
    default:
      return moment;
  }
}

function askPresenceOf(view: ConversationView): AskPresence | null {
  if (view.phase === 'halted') return null;
  const open = openAsk(view);
  if (open) return { mode: 'open', ...open };
  // After an interrupt the answer goes with the next message, and after a generation failure Retry submits it: the
  // composer returns in both.
  const pending = pendingAnswer(view);
  if (
    pending &&
    (view.phase === 'speaking' || view.phase === 'waiting' || view.phase === 'working')
  )
    return { mode: 'sent', ...pending };
  return null;
}

function canGoBackOf(view: ConversationView, connection: Connection): boolean {
  if (connection !== 'connected' || view.phase === 'halted') return false;
  return view.actions.slice(0, presentedIndex(view)).some(isSpeak);
}

export function present(
  view: ConversationView,
  connection: Connection,
  playback: PlaybackStatus,
  sendFailure: TransportError | null,
  unresolvedShows: ReadonlySet<ExecutionId>,
  reset: ResetState,
): Presentation {
  const moment = momentOf(view, connection, playback);
  const composer = COMPOSER[moment];
  return {
    moment,
    status: statusOf(view, moment, connection, playback, sendFailure, unresolvedShows, reset),
    composer,
    visual: VISUAL[moment],
    held: moment === 'held',
    subtitle: subtitleOf(view, moment, playback),
    timeline: timelineOf(view, moment, playback),
    ask: askPresenceOf(view),
    interruptible: composer === 'busy' || composer === 'retryClip',
    canGoBack: canGoBackOf(view, connection),
    fault: view.actions.findLast((a) => a.type === 'tool_faulted')?.error.message ?? null,
    latestShow: latestShowHandle(view) ?? null,
    resetPending: reset.pending,
    thinkingSince: moment === 'thinking' ? (forwardThinkingSince(view) ?? null) : null,
  };
}
