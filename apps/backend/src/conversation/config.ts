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
export type ReasoningEffort = typeof ReasoningEffort.Type;

/** `llm.provider`: the provider type, which selects how it is reached, plus that type's options. */
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
  /**
   * Your ChatGPT subscription through Sign in with ChatGPT; run `pnpm chatgpt:login` once. It has
   * no `providers` connection: the sign-in authorizes OpenAI's Responses API.
   */
  Schema.Struct({
    type: Schema.Literal('chatgpt'),
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
