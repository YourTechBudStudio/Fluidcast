import * as CompatClient from '@effect/ai-openai-compat/OpenAiClient';
import * as CompatLanguageModel from '@effect/ai-openai-compat/OpenAiLanguageModel';
import * as OpenAiLanguageModel from '@effect/ai-openai/OpenAiLanguageModel';
import { type FileSystem, Layer } from 'effect';
import type { LanguageModel } from 'effect/unstable/ai';
import type { HttpClient } from 'effect/unstable/http';

import { chatGptClientLayer } from '../chatgpt/index.ts';
import { type Connection, openAiClientLayer } from '../providers.ts';
import type { ReasoningEffort } from './config.ts';

/** Resolved LLM settings: the provider type's options and how it is reached, with secrets resolved. */
export type LlmConfig = {
  readonly model: string;
  readonly temperature?: number;
  readonly reasoningEffort?: ReasoningEffort;
} & (
  | {
      /** An API-key provider, reached through its connection. */
      readonly type: 'openai' | 'openai-compatible';
      readonly connection: Connection;
    }
  | {
      /** The ChatGPT sign-in, read from (and refreshed into) this file. */
      readonly type: 'chatgpt';
      readonly credentialsPath: string;
    }
);

/**
 * The `LanguageModel` for the configured provider: OpenAI's Responses API through
 * `@effect/ai-openai` (with an API key or the ChatGPT sign-in), or Chat Completions through
 * `@effect/ai-openai-compat`.
 */
export const languageModelLayer = (
  config: LlmConfig,
): Layer.Layer<
  LanguageModel.LanguageModel,
  never,
  HttpClient.HttpClient | FileSystem.FileSystem
> => {
  const effort = config.reasoningEffort;
  const sampling = config.temperature === undefined ? {} : { temperature: config.temperature };
  const reasoning = effort === undefined ? {} : { reasoning: { effort } };
  switch (config.type) {
    case 'openai':
      return OpenAiLanguageModel.layer({
        model: config.model,
        config: { ...sampling, ...reasoning },
      }).pipe(Layer.provide(openAiClientLayer(config.connection)));
    case 'chatgpt':
      return OpenAiLanguageModel.layer({
        model: config.model,
        // Agreed for the ChatGPT sign-in: responses are not stored at OpenAI.
        config: { store: false, ...sampling, ...reasoning },
      }).pipe(Layer.provide(chatGptClientLayer(config.credentialsPath)));
    case 'openai-compatible':
      return CompatLanguageModel.layer({
        model: config.model,
        // Chat Completions' own field; the adapter passes unknown fields through to the request.
        config: { ...sampling, ...(effort === undefined ? {} : { reasoning_effort: effort }) },
      }).pipe(
        Layer.provide(
          CompatClient.layer({
            apiKey: config.connection.apiKey,
            ...(config.connection.baseUrl === undefined
              ? {}
              : { apiUrl: config.connection.baseUrl }),
          }),
        ),
      );
  }
};
