import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { Schema } from 'effect';

import { Voice } from '@yourtechbudstudio/fluidcast-core/speech';

/**
 * How much the model reasons before replying, for models that support it. The OpenAI-style types'
 * levels; `anthropic` has its own (`AnthropicEffort`).
 */
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
 * Anthropic's effort levels, sent as `output_config.effort`. Absent leaves the model's default
 * (`medium` on Opus 5.5 and Haiku 5.5, `high` on Sonnet 5.5). Its own set, not Claude Code's
 * `ClaudeEffort`: the API and the agent SDK may diverge.
 */
export const AnthropicEffort = Schema.Literals(['low', 'medium', 'high', 'xhigh', 'max']);
export type AnthropicEffort = typeof AnthropicEffort.Type;

/**
 * Constrains the voice's replies to the output's JSON Schema (Core's `outputJsonSchema`) through
 * Chat Completions' `response_format`, as vLLM supports. Off by default. Only `openai-compatible`
 * takes it; loading the config rejects it on the other types.
 */
const structuredOutput = Schema.optionalKey(Schema.Boolean);

/** An LLM's `provider`: the provider type, which selects how it is reached, plus that type's options. */
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
  /**
   * Anthropic's Messages API. The model is an exact ID such as `claude-sonnet-5-5`. Prompt caching
   * is automatic. `temperature` is rejected: current Claude models reject non-default sampling.
   * `speed: fast` is fast mode, on Opus models only, at a premium price and with its own rate
   * limit; absent is `standard`.
   */
  Schema.Struct({
    type: Schema.Literal('anthropic'),
    reasoningEffort: Schema.optionalKey(AnthropicEffort),
    speed: Schema.optionalKey(Schema.Literals(['standard', 'fast'])),
    structuredOutput,
  }),
]);
export type LlmProvider = typeof LlmProvider.Type;

/** One chat model: `llm.voice` or `llm.summary`. */
export const LlmSection = Schema.Struct({
  model: Schema.NonEmptyString,
  provider: LlmProvider,
  /**
   * Sampling temperature. Absent uses the server's default, which is often the model's own. Not
   * accepted with `anthropic`.
   */
  temperature: Schema.optionalKey(
    Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
  ),
  /**
   * The most tokens one reply may use (`max_output_tokens`; `max_tokens` on Anthropic, where
   * thinking counts against it). Absent: the server's limit.
   */
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
 * `workers`: the agents behind `forward_agent`; the mode screen picks one per session. `cwd`
 * (relative to the config file, default its directory) is shared. Each agent's `model` and
 * `effort` apply to its new sessions. A continued session keeps its own model and directory, and
 * its recorded effort, falling back to the agent's `effort`. Codex effort levels vary by model, so
 * any non-empty string is accepted.
 */
export const WorkersSection = Schema.Struct({
  cwd: Schema.optionalKey(Schema.NonEmptyString),
  claude: Schema.optionalKey(
    Schema.Struct({
      model: Schema.optionalKey(Schema.NonEmptyString),
      effort: Schema.optionalKey(ClaudeEffort),
    }),
  ),
  codex: Schema.optionalKey(
    Schema.Struct({
      model: Schema.optionalKey(Schema.NonEmptyString),
      effort: Schema.optionalKey(Schema.NonEmptyString),
    }),
  ),
});
export type WorkersSection = typeof WorkersSection.Type;

/**
 * `llm`: the models. `voice` writes the conversation. `summary` optionally writes the Agent tool's
 * progress sentences and the history summaries; absent, the voice model writes both. Resolution
 * rejects `structuredOutput` under `summary`: its replies are plain text.
 */
export const LlmSections = Schema.Struct({
  voice: LlmSection,
  summary: Schema.optionalKey(LlmSection),
});
export type LlmSections = typeof LlmSections.Type;

/**
 * `history.compaction`: once a forward's generation reads more than `aboveInputTokens` input
 * tokens, everything before that episode is summarized for the voice. Off unless `enabled`;
 * `aboveInputTokens` defaults to the presets' `defaultCompactionThreshold`.
 */
export const HistorySection = Schema.Struct({
  compaction: Schema.optionalKey(
    Schema.Struct({
      enabled: Schema.optionalKey(Schema.Boolean),
      aboveInputTokens: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
    }),
  ),
});
export type HistorySection = typeof HistorySection.Type;

/** The conversation slice's config sections. */
export const ConversationSections = {
  llm: LlmSections,
  history: Schema.optionalKey(HistorySection),
  preset: PresetSection,
  workers: Schema.optionalKey(WorkersSection),
};
