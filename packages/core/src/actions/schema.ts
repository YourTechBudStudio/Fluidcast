import { Schema } from 'effect';

/** A UUIDv7 string that identifies one action in the log. Never shown to the model. */
export const ActionId = Schema.String.pipe(Schema.brand('ActionId'));
export type ActionId = typeof ActionId.Type;

/** A configured voice in the conversation. */
export const SpeakerProfile = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  personality: Schema.String,
});
export type SpeakerProfile = typeof SpeakerProfile.Type;

/**
 * The model-facing shape of a `speak` action: what the model writes, before an ID is assigned.
 * Its annotations become the doc comments of the TypeScript type in the system prompt.
 */
export const ModelSpeak = Schema.Struct({
  type: Schema.Literal('speak'),
  speaker: Schema.String.annotate({ description: 'Speaker id from <speakers>.' }),
  text: Schema.String.annotate({
    description: 'One or two spoken sentences. No markdown, lists, or anything unpronounceable.',
  }),
}).annotate({ identifier: 'Speak' });
export type ModelSpeak = typeof ModelSpeak.Type;

/** The model-authored subset of the action union: the model's output contract. */
export const ModelAction = Schema.Union([ModelSpeak]).annotate({ identifier: 'Action' });
export type ModelAction = typeof ModelAction.Type;

export const UserMessage = Schema.Struct({
  type: Schema.Literal('user_message'),
  id: ActionId,
  text: Schema.String,
});
export type UserMessage = typeof UserMessage.Type;

export const Speak = Schema.Struct({
  ...ModelSpeak.fields,
  id: ActionId,
});
export type Speak = typeof Speak.Type;

export const Interrupted = Schema.Struct({
  type: Schema.Literal('interrupted'),
  id: ActionId,
});
export type Interrupted = typeof Interrupted.Type;

/** A generation that ended in failure. `error` holds identifiers that are safe to display, never conversation content. */
export const GenerationFailed = Schema.Struct({
  type: Schema.Literal('generation_failed'),
  id: ActionId,
  error: Schema.Struct({
    tag: Schema.String,
    message: Schema.String,
  }),
});
export type GenerationFailed = typeof GenerationFailed.Type;

/** Every conversation fact: user-, model-, and runtime-authored actions in one flat union (ADR 0006). */
export const Action = Schema.Union([UserMessage, Speak, Interrupted, GenerationFailed]);
export type Action = typeof Action.Type;

/** Whether the model authored this action. Model-authored actions render as assistant output. */
export const isModelAuthored = (action: Action): action is Speak => action.type === 'speak';
