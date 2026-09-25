import * as CompatClient from '@effect/ai-openai-compat/OpenAiClient';
import * as CompatLanguageModel from '@effect/ai-openai-compat/OpenAiLanguageModel';
import * as OpenAiClient from '@effect/ai-openai/OpenAiClient';
import * as OpenAiLanguageModel from '@effect/ai-openai/OpenAiLanguageModel';
import { Layer } from 'effect';
import type { LanguageModel } from 'effect/unstable/ai';
import type { HttpClient } from 'effect/unstable/http';

import type { Connection } from '../providers.ts';
import type { LlmProvider } from './config.ts';

/** Resolved LLM settings: the provider's options and its connection, with the key read. */
export interface LlmConfig {
  readonly model: string;
  readonly provider: LlmProvider;
  readonly connection: Connection;
}

/**
 * The `LanguageModel` for the configured provider: OpenAI's Responses API through
 * `@effect/ai-openai`, or Chat Completions through `@effect/ai-openai-compat`.
 */
export const languageModelLayer = (
  config: LlmConfig,
): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> => {
  const client = {
    apiKey: config.connection.apiKey,
    ...(config.connection.baseUrl === undefined ? {} : { apiUrl: config.connection.baseUrl }),
  };
  const effort = config.provider.reasoningEffort;
  switch (config.provider.type) {
    case 'openai':
      return OpenAiLanguageModel.layer({
        model: config.model,
        ...(effort === undefined ? {} : { config: { reasoning: { effort } } }),
      }).pipe(Layer.provide(OpenAiClient.layer(client)));
    case 'openai-compatible':
      return CompatLanguageModel.layer({
        model: config.model,
        // Chat Completions' own field; the adapter passes unknown fields through to the request.
        ...(effort === undefined ? {} : { config: { reasoning_effort: effort } }),
      }).pipe(Layer.provide(CompatClient.layer(client)));
  }
};
