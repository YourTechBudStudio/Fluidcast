import * as CompatClient from '@effect/ai-openai-compat/OpenAiClient';
import * as CompatLanguageModel from '@effect/ai-openai-compat/OpenAiLanguageModel';
import * as OpenAiClient from '@effect/ai-openai/OpenAiClient';
import * as OpenAiLanguageModel from '@effect/ai-openai/OpenAiLanguageModel';
import { Layer, type Redacted } from 'effect';
import type { LanguageModel } from 'effect/unstable/ai';
import type { HttpClient } from 'effect/unstable/http';

/** Resolved LLM settings: defaults applied and the key read. */
export interface LlmConfig {
  readonly api: 'chat-completions' | 'responses';
  readonly baseUrl?: string;
  readonly model: string;
  readonly apiKey: Redacted.Redacted<string>;
}

/**
 * The `LanguageModel` for the configured API: Chat Completions through
 * `@effect/ai-openai-compat`, or OpenAI's Responses API through `@effect/ai-openai`.
 */
export const languageModelLayer = (
  config: LlmConfig,
): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> => {
  const client = {
    apiKey: config.apiKey,
    ...(config.baseUrl === undefined ? {} : { apiUrl: config.baseUrl }),
  };
  switch (config.api) {
    case 'chat-completions':
      return CompatLanguageModel.layer({ model: config.model }).pipe(
        Layer.provide(CompatClient.layer(client)),
      );
    case 'responses':
      return OpenAiLanguageModel.layer({ model: config.model }).pipe(
        Layer.provide(OpenAiClient.layer(client)),
      );
  }
};
