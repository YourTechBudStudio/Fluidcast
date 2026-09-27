import { Schema } from 'effect';

/** A UUIDv7 string that identifies one action in the log. Never shown to the model. */
export const ActionId = Schema.String.pipe(Schema.brand('ActionId'));
export type ActionId = typeof ActionId.Type;

/** A speaker as the model knows it: who it is and how it talks. How it sounds is not Core's to decide. */
export const SpeakerProfile = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
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
    description:
      'The next stretch of speech, continuing from the previous speak: a few words up to about three sentences. No markdown, lists, or anything unpronounceable.',
  }),
}).annotate({ identifier: 'Speak' });
export type ModelSpeak = typeof ModelSpeak.Type;

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

/** A JSON object, as the model wrote it. */
const JsonObject = Schema.Record(Schema.String, Schema.Json);

/**
 * Model-authored: a call to a tool. `tool` is the model's `type`, which may name no registered
 * tool; `input` is the model's element without its `type` and `call` keys. `handle` (`call_N`) is
 * assigned by the Harness and is how results refer to the call.
 */
export const ToolCall = Schema.Struct({
  type: Schema.Literal('tool_call'),
  id: ActionId,
  handle: Schema.String,
  tool: Schema.String,
  input: JsonObject,
});
export type ToolCall = typeof ToolCall.Type;

/** Runtime-authored: a tool result the model has read. `result` is encoded with the tool's `result` schema. */
export const ToolResult = Schema.Struct({
  type: Schema.Literal('tool_result'),
  id: ActionId,
  handle: Schema.String,
  tool: Schema.String,
  result: Schema.Json,
});
export type ToolResult = typeof ToolResult.Type;

/**
 * Runtime-authored: a tool error the model has read. `tool` is the call's `tool` as the model wrote
 * it, so it may name no registered tool. `message` is model-facing text.
 */
export const ToolErrored = Schema.Struct({
  type: Schema.Literal('tool_errored'),
  id: ActionId,
  handle: Schema.String,
  tool: Schema.String,
  message: Schema.String,
});
export type ToolErrored = typeof ToolErrored.Type;

/** Runtime-authored: a tool fault halted the conversation. `error` holds display-safe identifiers only. */
export const ToolFaulted = Schema.Struct({
  type: Schema.Literal('tool_faulted'),
  id: ActionId,
  handle: Schema.String,
  error: Schema.Struct({
    tag: Schema.String,
    message: Schema.String,
  }),
});
export type ToolFaulted = typeof ToolFaulted.Type;

/** Every conversation fact: user-, model-, and runtime-authored actions in one flat union (ADR 0006). */
export const Action = Schema.Union([
  UserMessage,
  Speak,
  ToolCall,
  Interrupted,
  GenerationFailed,
  ToolResult,
  ToolErrored,
  ToolFaulted,
]);
export type Action = typeof Action.Type;

/** Whether the model authored this action. Model-authored actions render as assistant output. */
export const isModelAuthored = (action: Action): action is Speak | ToolCall =>
  action.type === 'speak' || action.type === 'tool_call';
