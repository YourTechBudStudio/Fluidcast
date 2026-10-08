/**
 * The session protocol (ADR 0001): snapshot, events, commands, and the pure reducer and phase
 * derivation that both the Harness and every client fold with. A pure export: it imports only
 * `effect` and Core's action vocabulary.
 */
import { Schema } from 'effect';

import {
  Action,
  ActionId,
  LabeledContext,
  ToolErrored,
  ToolProgress,
  ToolResult,
  UserMessage,
  type Speak,
} from '@yourtechbudstudio/fluidcast-core/actions';

/** Identifies one request to play the speak at the cursor. Stale acknowledgements are rejected by it. */
export const PlaybackId = Schema.String.pipe(Schema.brand('PlaybackId'));
export type PlaybackId = typeof PlaybackId.Type;

/**
 * The latest iteration's status: in flight, or ended in failure. It describes the iteration, not an
 * action: the `generation_failed` action stays in the log as the conversation fact.
 */
export const Generation = Schema.Literals(['idle', 'running', 'failed']);
export type Generation = typeof Generation.Type;

/** The outstanding request to play the speak at the cursor. */
export const Playback = Schema.Struct({ playbackId: PlaybackId, actionId: ActionId });
export type Playback = typeof Playback.Type;

/** How clients label a speaker. */
export const SpeakerLabel = Schema.Struct({ id: Schema.String, name: Schema.String });
export type SpeakerLabel = typeof SpeakerLabel.Type;

/** Identifies one execution of a tool call. A call executes again, under a new ID, on forward replay. */
export const ExecutionId = Schema.String.pipe(Schema.brand('ExecutionId'));
export type ExecutionId = typeof ExecutionId.Type;

/**
 * An open execution. It completes every call in `handles` with its one outcome. `blocking` holds
 * every other result until it completes.
 */
export const Execution = Schema.Struct({
  executionId: ExecutionId,
  /** The calls this execution will complete, opening call first. */
  handles: Schema.NonEmptyArray(Schema.String),
  tool: Schema.String,
  blocking: Schema.Boolean,
  /** When it started, in epoch milliseconds (the Harness's clock). */
  startedAt: Schema.Number,
});
export type Execution = typeof Execution.Type;

/** A completed, model-visible tool outcome that has not been submitted to the model yet. */
export const PendingResult = Schema.Union([ToolResult, ToolErrored]);
export type PendingResult = typeof PendingResult.Type;

/** The latest progress update an execution offered while it could not be used yet. */
export const PendingProgress = Schema.Struct({ executionId: ExecutionId, text: Schema.String });
export type PendingProgress = typeof PendingProgress.Type;

/** A preloaded start waiting for `Start`: its message, and the context read before it. */
export const PendingStart = Schema.Struct({
  message: UserMessage,
  context: Schema.NullOr(LabeledContext),
});
export type PendingStart = typeof PendingStart.Type;

/**
 * The session state that snapshots carry and events fold into.
 * - `cursor` is the index of the current action; `actions.length` means "at the end". It is the
 *   execution frontier: actions take effect when it reaches them.
 * - `executions` are the open tool executions, in start order.
 * - `pendingResults` are completed outcomes waiting to be submitted. They enter `actions` only when
 *   submitted, so the log reads exactly as the model saw it.
 * - `replay` is the speak being re-presented behind the cursor after `Back`, or null. It is always
 *   below `cursor`.
 * - `pendingProgress` holds at most one progress update per open execution, the latest, kept while
 *   it could not be used (paused, or replacing one kept earlier). Submitted with the results.
 * - `start` is a preloaded start waiting for `Start`. Like `pendingResults`, it is beside the log
 *   until submitted.
 * - `paused` holds presentation and new iterations (`Pause`, `Play`). Running generation and tools
 *   continue. Orthogonal to the phase.
 * - `speakers` and `speech` are fixed by the session's config and never change.
 */
export const SessionState = Schema.Struct({
  actions: Schema.Array(Action),
  cursor: Schema.Int,
  generation: Generation,
  playback: Schema.NullOr(Playback),
  executions: Schema.Array(Execution),
  pendingResults: Schema.Array(PendingResult),
  pendingProgress: Schema.Array(PendingProgress),
  replay: Schema.NullOr(Schema.Int),
  start: Schema.NullOr(PendingStart),
  paused: Schema.Boolean,
  speakers: Schema.Array(SpeakerLabel),
  speech: Schema.Struct({ mimeType: Schema.String }),
});
export type SessionState = typeof SessionState.Type;

/**
 * The phase a player presents. Always derived (`derivePhase`), never stored. `working`: the system
 * is busy and nothing is playing. `waiting`: a blocking tool waits on the user. `halted` is
 * terminal: a tool fault stopped the conversation. `ready`: a preloaded start waits for `Start`.
 */
export const Phase = Schema.Literals([
  'ready',
  'idle',
  'speaking',
  'waiting',
  'working',
  'generationFailed',
  'halted',
]);
export type Phase = typeof Phase.Type;

// Events

/** An action was appended to the log. When the cursor was at the end, it now rests on this action. */
export const ActionAppended = Schema.TaggedStruct('ActionAppended', { action: Action });
/** Every action from index `from` on was removed. Only actions after the cursor are ever trimmed. */
export const ActionsTrimmed = Schema.TaggedStruct('ActionsTrimmed', { from: Schema.Int });
/** The cursor moved, possibly onto a tool call it is about to start. Any outstanding playback is cleared. */
export const CursorMoved = Schema.TaggedStruct('CursorMoved', { cursor: Schema.Int });
/** Play the speak at the cursor, then acknowledge with this `playbackId`. */
export const PlaybackRequested = Schema.TaggedStruct('PlaybackRequested', {
  playbackId: PlaybackId,
  actionId: ActionId,
});
export const GenerationChanged = Schema.TaggedStruct('GenerationChanged', {
  generation: Generation,
});

/** A tool call started executing. Its call is already in the effective actions (or behind the cursor, on replay). */
export const ToolStarted = Schema.TaggedStruct('ToolStarted', Execution.fields);
/** A newly reached call joined an open execution: its outcome now completes this handle too. */
export const ToolJoined = Schema.TaggedStruct('ToolJoined', {
  executionId: ExecutionId,
  handle: Schema.String,
});
/** The execution ended. Any model-visible outcome was queued just before; its kept progress is dropped. */
export const ToolCompleted = Schema.TaggedStruct('ToolCompleted', { executionId: ExecutionId });
/** A model-visible outcome waits to be submitted. */
export const ResultQueued = Schema.TaggedStruct('ResultQueued', { result: PendingResult });
/**
 * Every pending result, then `progress` (the kept progress updates, in execution start order, with
 * each execution's handles at submission), was submitted to the model and appended to the log.
 * Both queues are now empty.
 */
export const ResultsSubmitted = Schema.TaggedStruct('ResultsSubmitted', {
  progress: Schema.Array(ToolProgress),
});
/** An execution's progress update is kept, replacing any it kept before. */
export const ProgressQueued = Schema.TaggedStruct('ProgressQueued', PendingProgress.fields);
/** Every kept progress update was dropped: a halt means none can be submitted. */
export const ProgressDiscarded = Schema.TaggedStruct('ProgressDiscarded', {});
/** The preloaded start was submitted: its context, then its message, are appended to the log. */
export const StartSubmitted = Schema.TaggedStruct('StartSubmitted', {});
/** The replay position moved, or ended (`null`). Any outstanding playback is cleared. */
export const ReplayMoved = Schema.TaggedStruct('ReplayMoved', {
  replay: Schema.NullOr(Schema.Int),
});
/** Presentation is held (`Pause`) or released (`Play`). */
export const PauseChanged = Schema.TaggedStruct('PauseChanged', { paused: Schema.Boolean });
/**
 * The outstanding playback request no longer holds: a paused session took a new subscription.
 * Stop the old clip; `Play` requests the line again.
 */
export const PlaybackCleared = Schema.TaggedStruct('PlaybackCleared', {});

export const SessionEvent = Schema.Union([
  ActionAppended,
  ActionsTrimmed,
  CursorMoved,
  PlaybackRequested,
  GenerationChanged,
  ToolStarted,
  ToolJoined,
  ToolCompleted,
  ResultQueued,
  ResultsSubmitted,
  ProgressQueued,
  ProgressDiscarded,
  StartSubmitted,
  ReplayMoved,
  PauseChanged,
  PlaybackCleared,
]);
export type SessionEvent = typeof SessionEvent.Type;

// Subscription

/** The first message of every subscription: the state that the following events fold into. */
export const Snapshot = Schema.TaggedStruct('Snapshot', { state: SessionState });
/** The terminal message sent when a newer subscription takes over (last connection wins). */
export const Superseded = Schema.TaggedStruct('Superseded', {});

export const SubscriptionMessage = Schema.Union([Snapshot, SessionEvent, Superseded]);
export type SubscriptionMessage = typeof SubscriptionMessage.Type;

// Commands

export const SendMessage = Schema.TaggedStruct('SendMessage', { text: Schema.String });
/** Playback of the given request completed. Ignored unless it matches the outstanding playback. */
export const PlaybackFinished = Schema.TaggedStruct('PlaybackFinished', { playbackId: PlaybackId });
export const Interrupt = Schema.TaggedStruct('Interrupt', {});
export const RetryGeneration = Schema.TaggedStruct('RetryGeneration', {});

/**
 * A client's reply to an open execution, validated against that execution's command schema.
 * `handle` is any call the execution holds.
 */
export const ToolCommand = Schema.TaggedStruct('ToolCommand', {
  handle: Schema.String,
  executionId: ExecutionId,
  payload: Schema.Json,
});
/** Re-presents the previous speak; forward replay follows. */
export const Back = Schema.TaggedStruct('Back', {});
/** Submits the preloaded start (phase `ready`); generation begins after it. */
export const Start = Schema.TaggedStruct('Start', {});
/** Holds presentation and new iterations. Idempotent. */
export const Pause = Schema.TaggedStruct('Pause', {});
/**
 * Releases a pause and continues from the presented action, or submits the preloaded start
 * (phase `ready`). Otherwise a no-op. Idempotent.
 */
export const Play = Schema.TaggedStruct('Play', {});
/**
 * Moves presentation forward as if the presented speak finished, or processes the buffered action
 * at the cursor, even while paused. Never requests playback while paused.
 */
export const Next = Schema.TaggedStruct('Next', {});

export const Command = Schema.Union([
  SendMessage,
  PlaybackFinished,
  Interrupt,
  RetryGeneration,
  ToolCommand,
  Back,
  Start,
  Pause,
  Play,
  Next,
]);
export type Command = typeof Command.Type;

/** The command is not valid in the current phase. */
export class CommandRejected extends Schema.TaggedError<CommandRejected>()('CommandRejected', {
  command: Schema.Literals([
    'SendMessage',
    'Interrupt',
    'RetryGeneration',
    'ToolCommand',
    'Back',
    'Start',
    'Pause',
    'Play',
    'Next',
  ]),
  phase: Phase,
}) {}

/**
 * A `ToolCommand` was not accepted: its execution is not open (`stale`), or its payload does not
 * match the execution's command schema (`invalid`, and the execution stays open). Identifiers only.
 */
export class ToolCommandRejected extends Schema.TaggedError<ToolCommandRejected>()(
  'ToolCommandRejected',
  {
    executionId: Schema.String,
    reason: Schema.Literals(['stale', 'invalid']),
  },
) {}

/** The action is not a speak currently in the log: unknown, trimmed, or of another type. */
export class SpeechNotFound extends Schema.TaggedError<SpeechNotFound>()('SpeechNotFound', {
  actionId: Schema.String,
}) {}

// Pure functions

/** Folds one event into the state. The Harness and clients apply exactly this function. */
export const reduce = (state: SessionState, event: SessionEvent): SessionState => {
  switch (event._tag) {
    case 'ActionAppended':
      return { ...state, actions: [...state.actions, event.action] };
    case 'ActionsTrimmed':
      return { ...state, actions: state.actions.slice(0, event.from) };
    case 'CursorMoved':
      return { ...state, cursor: event.cursor, playback: null };
    case 'PlaybackRequested':
      return { ...state, playback: { playbackId: event.playbackId, actionId: event.actionId } };
    case 'GenerationChanged':
      return { ...state, generation: event.generation };
    case 'ToolStarted': {
      const { _tag, ...execution } = event;
      return { ...state, executions: [...state.executions, execution] };
    }
    case 'ToolJoined':
      return {
        ...state,
        executions: state.executions.map((execution) =>
          execution.executionId === event.executionId
            ? { ...execution, handles: [...execution.handles, event.handle] }
            : execution,
        ),
      };
    case 'ToolCompleted':
      return {
        ...state,
        executions: state.executions.filter(
          (execution) => execution.executionId !== event.executionId,
        ),
        pendingProgress: state.pendingProgress.filter(
          (progress) => progress.executionId !== event.executionId,
        ),
      };
    case 'ResultQueued':
      return { ...state, pendingResults: [...state.pendingResults, event.result] };
    case 'ResultsSubmitted':
      return {
        ...state,
        actions: [...state.actions, ...state.pendingResults, ...event.progress],
        pendingResults: [],
        pendingProgress: [],
      };
    case 'ProgressQueued': {
      const { _tag, ...progress } = event;
      const others = state.pendingProgress.filter(
        (candidate) => candidate.executionId !== progress.executionId,
      );
      return { ...state, pendingProgress: [...others, progress] };
    }
    case 'ProgressDiscarded':
      return { ...state, pendingProgress: [] };
    case 'StartSubmitted': {
      if (state.start === null) return state;
      const { message, context } = state.start;
      return {
        ...state,
        actions: [...state.actions, ...(context === null ? [] : [context]), message],
        start: null,
      };
    }
    case 'ReplayMoved':
      return { ...state, replay: event.replay, playback: null };
    case 'PauseChanged':
      return { ...state, paused: event.paused };
    case 'PlaybackCleared':
      return { ...state, playback: null };
  }
};

/** What the player presents: the replay position, or else the cursor. */
export const presentedPosition = (state: SessionState): number => state.replay ?? state.cursor;

/** The action at the presented position, if it is not at the end. */
export const currentAction = (state: SessionState): Action | undefined =>
  state.actions[presentedPosition(state)];

/** The actions that have taken effect or are taking effect: everything up to and including the cursor. */
export const effectiveActions = (state: SessionState): ReadonlyArray<Action> =>
  state.actions.slice(0, state.cursor + 1);

/** The open blocking execution, if any. */
export const blockingExecution = (state: SessionState): Execution | undefined =>
  state.executions.find((execution) => execution.blocking);

/** Whether a tool fault halted the conversation. A halt is terminal. */
export const isHalted = (state: SessionState): boolean =>
  state.actions.some((action) => action.type === 'tool_faulted');

/** Where `Back` goes: the last speak before the presented position, if any. */
export const backTarget = (state: SessionState): number | undefined => {
  for (let index = presentedPosition(state) - 1; index >= 0; index--) {
    if (state.actions[index]?.type === 'speak') return index;
  }
  return undefined;
};

/** The speak being presented: at the replay position while replaying, else at the cursor. */
export const presentedSpeak = (state: SessionState): Speak | undefined => {
  const action = currentAction(state);
  return action?.type === 'speak' ? action : undefined;
};

/**
 * The phase a player presents, first match wins. `ready`: a preloaded start waits, so nothing
 * else applies yet. `working`: the system is busy (generating,
 * starting a call, holding results or running tools) and nothing is playing. `waiting`: a blocking
 * tool waits on the user. An interrupt cancels a blocking execution and leaves the others and
 * pending results for the user's next message, so the turn reads `idle`.
 */
export const derivePhase = (state: SessionState): Phase => {
  if (isHalted(state)) return 'halted';
  if (state.start !== null) return 'ready';
  const current = currentAction(state);
  if (current?.type === 'speak') return 'speaking';
  if (blockingExecution(state) !== undefined) return 'waiting';
  if (current?.type === 'tool_call') return 'working';
  if (state.generation === 'running') return 'working';
  if (state.generation === 'failed') return 'generationFailed';
  if (state.actions.at(-1)?.type === 'interrupted') return 'idle';
  if (state.pendingResults.length > 0 || state.executions.length > 0) return 'working';
  return 'idle';
};

/** `derivePhase` at the execution frontier, as if no replay were presented. */
export const frontierPhase = (state: SessionState): Phase =>
  derivePhase({ ...state, replay: null });

/**
 * Whether `SendMessage` is accepted: never once halted; in phase `idle` or `generationFailed`; and,
 * while paused, also when the only thing left is queued results (nothing generating, presented,
 * replayed or running), which the message then submits with it.
 */
export const canSend = (state: SessionState): boolean => {
  if (isHalted(state)) return false;
  const phase = derivePhase(state);
  if (phase === 'idle' || phase === 'generationFailed') return true;
  return (
    state.paused &&
    state.generation === 'idle' &&
    state.replay === null &&
    state.cursor === state.actions.length &&
    state.executions.length === 0 &&
    state.pendingResults.length > 0
  );
};

/** Whether `Next` has something to move past or process: a replay, or an action at the cursor. */
export const canAdvance = (state: SessionState): boolean =>
  !isHalted(state) && (state.replay !== null || state.cursor < state.actions.length);

/**
 * Which player controls do something now. For presentation: `Pause` and `Play` are also accepted
 * as no-ops when these are false, and the Harness validates every command again.
 */
export interface Controls {
  readonly back: boolean;
  readonly next: boolean;
  /** Releases a pause, or submits a preloaded start. */
  readonly play: boolean;
  readonly pause: boolean;
  readonly send: boolean;
}

export const controls = (state: SessionState): Controls => {
  const halted = isHalted(state);
  return {
    back: !halted && backTarget(state) !== undefined,
    next: canAdvance(state),
    play: !halted && (state.paused || state.start !== null),
    pause: !halted && !state.paused,
    send: canSend(state),
  };
};
