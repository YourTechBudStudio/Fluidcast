/**
 * A local mirror of the planned Harness protocol view (ADR 0006, ADR 0007): the actions up to the cursor, and the phase
 * derived from them. Phase 5 replaces these with the types exported from `harness/protocol` and reconciles any drift.
 */
export type Action =
  | { readonly type: 'user_message'; readonly id: string; readonly text: string }
  | { readonly type: 'speak'; readonly id: string; readonly speaker: string; readonly text: string }
  | { readonly type: 'interrupted'; readonly id: string }
  | {
      readonly type: 'generation_failed';
      readonly id: string;
      readonly error: { readonly tag: string; readonly message: string };
    };

export type ActionType = Action['type'];

/** Protocol phase: derived by the Harness from the log, the cursor and the generation status. */
export type Phase = 'idle' | 'speaking' | 'waiting' | 'generationFailed';

/** Client connection to the backend. */
export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'superseded';

/** A configured voice. Only its id appears in actions. */
export interface Speaker {
  readonly id: string;
  readonly name: string;
}

export interface ConversationView {
  /** Actions up to and including the cursor. */
  readonly actions: readonly Action[];
  readonly phase: Phase;
  readonly speakers: readonly Speaker[];
}

/** What the UI can ask of the conversation. Each becomes a command to the Harness in phase 5. */
export interface ConversationCommands {
  readonly sendMessage: (text: string) => void;
  readonly interrupt: () => void;
  readonly retryGeneration: () => void;
}
