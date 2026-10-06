import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { Schema } from 'effect';

import { Voice } from '@yourtechbudstudio/fluidcast-core/speech';

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

/**
 * Constrains the voice's replies to the output's JSON Schema (Core's `outputJsonSchema`) through
 * Chat Completions' `response_format`, as vLLM supports. Off by default. Only `openai-compatible`
 * takes it; loading the config rejects it on the other types.
 */
const structuredOutput = Schema.optionalKey(Schema.Boolean);

/** `llm.provider`: the provider type, which selects how it is reached, plus that type's options. */
export const LlmProvider = Schema.Union([
  /** OpenAI's Responses API. */
  Schema.Struct({
    type: Schema.Literal('openai'),
    reasoningEffort: Schema.optionalKey(ReasoningEffort),
    structuredOutput,
  }),
  /** Chat Completions on any compatible server. */
  Schema.Struct({
    type: Schema.Literal('openai-compatible'),
    reasoningEffort: Schema.optionalKey(ReasoningEffort),
    structuredOutput,
  }),
  /**
   * Your ChatGPT subscription through Sign in with ChatGPT; run `pnpm chatgpt:login` once. It has
   * no `providers` connection: the sign-in authorizes OpenAI's Responses API.
   */
  Schema.Struct({
    type: Schema.Literal('chatgpt'),
    reasoningEffort: Schema.optionalKey(ReasoningEffort),
    structuredOutput,
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
  /** The most tokens one reply may use (`max_output_tokens`). Absent: the server's limit. */
  maxOutputTokens: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type LlmSection = typeof LlmSection.Type;

/**
 * `preset`: the voice's behavior, the Guided Walkthrough preset. `profile` is `detailed` (default,
 * tuned for smaller models such as Qwen) or `compact` (the protocol alone, for capable models).
 * `voice` is the speaker's synthesized voice, in the speech provider's names.
 */
export const PresetSection = Schema.Struct({
  profile: Schema.optionalKey(Schema.Literals(['compact', 'detailed'])),
  voice: Voice,
});
export type PresetSection = typeof PresetSection.Type;

/**
 * Claude Code's effort levels, one key per level of the SDK's `EffortLevel`. The `satisfies` fails
 * to compile if the SDK gains or drops a level, so `ClaudeEffort` cannot drift from it.
 */
const effortLevels = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
} as const satisfies { readonly [Level in EffortLevel]: Level };

/** Claude Code's effort levels. Kept identical to the SDK's `EffortLevel`, which is checked above. */
export const ClaudeEffort = Schema.Literals(Object.values(effortLevels));
export type ClaudeEffort = typeof ClaudeEffort.Type;

/**
 * `workers`: the agent behind `forward_agent`. `cwd` (relative to the config file, default its
 * directory), `claude.model` and `claude.effort` apply to new sessions. A continued session keeps
 * its own model and directory, and its recorded effort, falling back to `claude.effort`.
 */
export const WorkersSection = Schema.Struct({
  cwd: Schema.optionalKey(Schema.NonEmptyString),
  claude: Schema.optionalKey(
    Schema.Struct({
      model: Schema.optionalKey(Schema.NonEmptyString),
      effort: Schema.optionalKey(ClaudeEffort),
    }),
  ),
});
export type WorkersSection = typeof WorkersSection.Type;

/** The conversation slice's config sections. */
export const ConversationSections = {
  llm: LlmSection,
  preset: PresetSection,
  workers: Schema.optionalKey(WorkersSection),
};
