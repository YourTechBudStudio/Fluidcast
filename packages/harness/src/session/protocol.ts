/**
 * The session protocol (ADR 0001): snapshot, events, commands, and the pure reducer and phase
 * derivation that both the Harness and every client fold with. A pure export: it imports only
 * `effect` and Core's action vocabulary.
 */
import { Schema } from 'effect';

import {
  Action,
  ActionId,
  ToolErrored,
  ToolResult,
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

/**
 * The session state that snapshots carry and events fold into.
 * - `cursor` is the index of the current action; `actions.length` means "at the end". It is the
 *   execution frontier: actions take effect when it reaches them.
 * - `executions` are the open tool executions, in start order.
 * - `pendingResults` are completed outcomes waiting to be submitted. They enter `actions` only when
 *   submitted, so the log reads exactly as the model saw it.
 * - `replay` is the speak being re-presented behind the cursor after `Back`, or null. It is always
 *   below `cursor`.
 * - `speakers` and `speech` are fixed by the session's config and never change.
 */
export const SessionState = Schema.Struct({
  actions: Schema.Array(Action),
  cursor: Schema.Int,
  generation: Generation,
  playback: Schema.NullOr(Playback),
  executions: Schema.Array(Execution),
  pendingResults: Schema.Array(PendingResult),
  replay: Schema.NullOr(Schema.Int),
  speakers: Schema.Array(SpeakerLabel),
  speech: Schema.Struct({ mimeType: Schema.String }),
});
export type SessionState = typeof SessionState.Type;

/**
 * The phase a player presents. Always derived (`derivePhase`), never stored. `working`: the system
 * is busy and nothing is playing. `waiting`: a blocking tool waits on the user. `halted` is
 * terminal: a tool fault stopped the conversation.
 */
export const Phase = Schema.Literals([
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
/** The execution ended. Any model-visible outcome was queued just before. */
export const ToolCompleted = Schema.TaggedStruct('ToolCompleted', { executionId: ExecutionId });
/** A model-visible outcome waits to be submitted. */
export const ResultQueued = Schema.TaggedStruct('ResultQueued', { result: PendingResult });
/** Every pending result was submitted to the model: they are appended to the log in order. */
export const ResultsSubmitted = Schema.TaggedStruct('ResultsSubmitted', {});
/** The replay position moved, or ended (`null`). Any outstanding playback is cleared. */
export const ReplayMoved = Schema.TaggedStruct('ReplayMoved', {
  replay: Schema.NullOr(Schema.Int),
});

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
  ReplayMoved,
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

export const Command = Schema.Union([
  SendMessage,
  PlaybackFinished,
  Interrupt,
  RetryGeneration,
  ToolCommand,
  Back,
]);
export type Command = typeof Command.Type;

/** The command is not valid in the current phase. */
export class CommandRejected extends Schema.TaggedError<CommandRejected>()('CommandRejected', {
  command: Schema.Literals(['SendMessage', 'Interrupt', 'RetryGeneration', 'ToolCommand', 'Back']),
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
      };
    case 'ResultQueued':
      return { ...state, pendingResults: [...state.pendingResults, event.result] };
    case 'ResultsSubmitted':
      return { ...state, actions: [...state.actions, ...state.pendingResults], pendingResults: [] };
    case 'ReplayMoved':
      return { ...state, replay: event.replay, playback: null };
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
 * The phase a player presents, first match wins. `working`: the system is busy (generating,
 * starting a call, holding results or running tools) and nothing is playing. `waiting`: a blocking
 * tool waits on the user. An interrupt cancels a blocking execution and leaves the others and
 * pending results for the user's next message, so the turn reads `idle`.
 */
export const derivePhase = (state: SessionState): Phase => {
  if (isHalted(state)) return 'halted';
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
