import { Schema } from 'effect';

import { SessionSpeakers } from '@yourtechbudstudio/fluidcast-harness';

/** How much the model reasons before replying, for models that support it. */
export const ReasoningEffort = Schema.Literals([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

/** `llm.provider`: the provider type, which selects its connection, plus that type's options. */
export const LlmProvider = Schema.Union([
  /** OpenAI's Responses API. */
  Schema.Struct({
    type: Schema.Literal('openai'),
    reasoningEffort: Schema.optionalKey(ReasoningEffort),
  }),
  /** Chat Completions on any compatible server. */
  Schema.Struct({
    type: Schema.Literal('openai-compatible'),
    reasoningEffort: Schema.optionalKey(ReasoningEffort),
  }),
]);
export type LlmProvider = typeof LlmProvider.Type;

/** The chat model. */
export const LlmSection = Schema.Struct({
  model: Schema.NonEmptyString,
  provider: LlmProvider,
  /** Sampling temperature. Absent uses the server's default, which is often the model's own. */
  temperature: Schema.optionalKey(
    Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
  ),
});
export type LlmSection = typeof LlmSection.Type;

/** The conversation slice's config sections. Speakers are the Harness's own schema; the first is the lead. */
export const ConversationSections = {
  llm: LlmSection,
  instructions: Schema.optionalKey(Schema.String),
  speakers: SessionSpeakers,
};
