/**
 * The session protocol (ADR 0007): snapshot, events, commands, and the pure reducer and phase
 * derivation that both the Harness and every client fold with. A pure export: it imports only
 * `effect` and Core's action vocabulary.
 */
import { Schema } from 'effect';

import { Action, ActionId } from '@yourtechbudstudio/fluidcast-core/actions';

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

/**
 * The session state that snapshots carry and events fold into.
 * - `cursor` is the index of the current action; `actions.length` means "at the end".
 * - `speakers` and `speech` are fixed by the session's config and never change.
 */
export const SessionState = Schema.Struct({
  actions: Schema.Array(Action),
  cursor: Schema.Int,
  generation: Generation,
  playback: Schema.NullOr(Playback),
  speakers: Schema.Array(SpeakerLabel),
  speech: Schema.Struct({ mimeType: Schema.String }),
});
export type SessionState = typeof SessionState.Type;

/** The phase a player presents. Always derived (`derivePhase`), never stored. */
export const Phase = Schema.Literals(['idle', 'speaking', 'waiting', 'generationFailed']);
export type Phase = typeof Phase.Type;

// Events

/** An action was appended to the log. When the cursor was at the end, it now rests on this action. */
export const ActionAppended = Schema.TaggedStruct('ActionAppended', { action: Action });
/** Every action from index `from` on was removed. Only actions after the cursor are ever trimmed. */
export const ActionsTrimmed = Schema.TaggedStruct('ActionsTrimmed', { from: Schema.Int });
/** The cursor moved. Any outstanding playback is cleared. */
export const CursorMoved = Schema.TaggedStruct('CursorMoved', { cursor: Schema.Int });
/** Play the speak at the cursor, then acknowledge with this `playbackId`. */
export const PlaybackRequested = Schema.TaggedStruct('PlaybackRequested', {
  playbackId: PlaybackId,
  actionId: ActionId,
});
export const GenerationChanged = Schema.TaggedStruct('GenerationChanged', {
  generation: Generation,
});

export const SessionEvent = Schema.Union([
  ActionAppended,
  ActionsTrimmed,
  CursorMoved,
  PlaybackRequested,
  GenerationChanged,
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

export const Command = Schema.Union([SendMessage, PlaybackFinished, Interrupt, RetryGeneration]);
export type Command = typeof Command.Type;

/** The command is not valid in the current phase. */
export class CommandRejected extends Schema.TaggedError<CommandRejected>()('CommandRejected', {
  command: Schema.Literals(['SendMessage', 'Interrupt', 'RetryGeneration']),
  phase: Phase,
}) {}

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
  }
};

/** The action at the cursor, if the cursor is not at the end. */
export const currentAction = (state: SessionState): Action | undefined =>
  state.actions[state.cursor];

/** The actions that have taken effect or are taking effect: everything up to and including the cursor. */
export const effectiveActions = (state: SessionState): ReadonlyArray<Action> =>
  state.actions.slice(0, state.cursor + 1);

/**
 * The phase a player presents. A non-speak action at the cursor is instant and is passed in the
 * same step that reached it, so only a speak at the cursor holds the phase.
 */
export const derivePhase = (state: SessionState): Phase => {
  if (currentAction(state)?.type === 'speak') return 'speaking';
  if (state.generation === 'running') return 'waiting';
  if (state.generation === 'failed') return 'generationFailed';
  return 'idle';
};
