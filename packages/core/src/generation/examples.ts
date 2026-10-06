import { Schema } from 'effect';

/**
 * One step of a worked example. `speak` lines belong to the lead speaker. A `tool_call` is written
 * without a `call` field, as the model writes it; `handle` only links it to its `tool_result`. An
 * `interrupted` step reads as the interruption notice history shows.
 */
export const ExampleStep = Schema.Union([
  Schema.Struct({ type: Schema.Literal('user_message'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('speak'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('interrupted'),
    during: Schema.Literals(['speech', 'wait']),
  }),
  Schema.Struct({
    type: Schema.Literal('tool_call'),
    tool: Schema.String,
    handle: Schema.String,
    input: Schema.Record(Schema.String, Schema.Json),
  }),
  Schema.Struct({
    type: Schema.Literal('tool_result'),
    tool: Schema.String,
    handle: Schema.String,
    /** Encoded with the tool's `result` schema, as the log stores it. */
    result: Schema.Json,
  }),
]);
export type ExampleStep = typeof ExampleStep.Type;

/**
 * An application-supplied worked example: a short exchange of listener-side steps, each followed by
 * the model's response. Core renders it in the prompt exactly as it renders history, and
 * `checkTools` rejects one that does not fit the configured tools.
 */
export const Example = Schema.Array(ExampleStep);
export type Example = typeof Example.Type;
