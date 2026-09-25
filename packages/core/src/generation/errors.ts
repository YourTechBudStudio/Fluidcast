import { Schema } from 'effect';

/**
 * The language model provider failed. Carries only identifiers (the failure's reason tag, HTTP
 * status, provider error code), never the provider's message text, which can echo the prompt.
 */
export class ProviderError extends Schema.TaggedError<ProviderError>()('ProviderError', {
  reason: Schema.String,
  status: Schema.optional(Schema.Number),
  code: Schema.optional(Schema.String),
}) {}

/** The model's output was not a complete JSON array: none was started, or it never closed. */
export class MalformedOutput extends Schema.TaggedError<MalformedOutput>()('MalformedOutput', {
  reason: Schema.Literals(['no_array', 'unterminated']),
}) {}

/** The array element at `index` was not valid JSON, did not match the action schema, or named an unknown speaker. */
export class InvalidAction extends Schema.TaggedError<InvalidAction>()('InvalidAction', {
  index: Schema.Number,
  reason: Schema.Literals(['json', 'schema', 'unknown_speaker']),
}) {}

export type GenerationError = ProviderError | MalformedOutput | InvalidAction;
