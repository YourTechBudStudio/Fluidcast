import * as AnthropicClient from '@effect/ai-anthropic/AnthropicClient';
import * as OpenAiClient from '@effect/ai-openai/OpenAiClient';
import { Schema, type Layer, type Redacted } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';

/**
 * The provider types reached with an API key. `openai` is OpenAI's API (Responses for generation,
 * `/audio/speech` for TTS); `openai-compatible` is any server that speaks Chat Completions, and
 * `anthropic` is Anthropic's Messages API, both for generation only.
 */
export const ProviderType = Schema.Literals(['openai', 'openai-compatible', 'anthropic']);
export type ProviderType = typeof ProviderType.Type;

/** How a provider is reached. Shared by every section that uses the provider. */
export const ConnectionSection = Schema.Struct({
  /**
   * Base URL of the API. Defaults to the provider's own: `https://api.openai.com/v1` for OpenAI,
   * `https://api.anthropic.com` (without `/v1`) for Anthropic.
   */
  baseUrl: Schema.optionalKey(Schema.NonEmptyString),
  /** The environment variable holding the key. Defaults to `defaultApiKeyEnv[type]`. */
  apiKeyEnv: Schema.optionalKey(Schema.NonEmptyString),
});
export type ConnectionSection = typeof ConnectionSection.Type;

/** `providers`: one connection per provider type. An absent entry uses the defaults. */
export const ProvidersSection = Schema.Struct({
  openai: Schema.optionalKey(ConnectionSection),
  'openai-compatible': Schema.optionalKey(ConnectionSection),
  anthropic: Schema.optionalKey(ConnectionSection),
});
export type ProvidersSection = typeof ProvidersSection.Type;

export const defaultApiKeyEnv: Readonly<Record<ProviderType, string>> = {
  openai: 'FLUIDCAST_OPENAI_API_KEY',
  'openai-compatible': 'FLUIDCAST_OPENAI_COMPATIBLE_API_KEY',
  anthropic: 'FLUIDCAST_ANTHROPIC_API_KEY',
};

/** A resolved connection: the key read. */
export interface Connection {
  readonly baseUrl?: string;
  readonly apiKey: Redacted.Redacted<string>;
}

/**
 * The `OpenAiClient` for an API-key connection: OpenAI's API, or `baseUrl` when set. The one place
 * the backend turns a `Connection` into an `OpenAiClient`.
 */
export const openAiClientLayer = (
  connection: Connection,
): Layer.Layer<OpenAiClient.OpenAiClient, never, HttpClient.HttpClient> =>
  OpenAiClient.layer({
    apiKey: connection.apiKey,
    ...(connection.baseUrl === undefined ? {} : { apiUrl: connection.baseUrl }),
  });

/** The beta that enables fast mode (the request's `speed: "fast"`). */
const fastModeBeta = 'fast-mode-2026-02-01';

/**
 * Adds the fast-mode beta to the request's `anthropic-beta` header, keeping the betas the library
 * set for the request (it sends a comma-separated list) and never adding it twice.
 */
export const appendAnthropicBeta = (
  request: HttpClientRequest.HttpClientRequest,
): HttpClientRequest.HttpClientRequest => {
  const betas = (request.headers['anthropic-beta'] ?? '')
    .split(',')
    .map((beta) => beta.trim())
    .filter((beta) => beta !== '');
  return betas.includes(fastModeBeta)
    ? request
    : HttpClientRequest.setHeader(request, 'anthropic-beta', [...betas, fastModeBeta].join(','));
};

/**
 * The `AnthropicClient` for an API-key connection: Anthropic's API, or `baseUrl` when set. The one
 * place the backend turns a `Connection` into an `AnthropicClient`. With `fastMode`, every request
 * carries the fast-mode beta. It is added on the client, after the library has set its own betas,
 * because `AnthropicConfig.withClientTransform` does not apply to streamed requests.
 */
export const anthropicClientLayer = (
  connection: Connection,
  options: { readonly fastMode: boolean },
): Layer.Layer<AnthropicClient.AnthropicClient, never, HttpClient.HttpClient> =>
  AnthropicClient.layer({
    apiKey: connection.apiKey,
    ...(connection.baseUrl === undefined ? {} : { apiUrl: connection.baseUrl }),
    ...(options.fastMode ? { transformClient: HttpClient.mapRequest(appendAnthropicBeta) } : {}),
  });
