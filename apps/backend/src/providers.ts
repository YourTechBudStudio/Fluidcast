import { Schema, type Redacted } from 'effect';

/**
 * The provider types. `openai` is OpenAI's API (Responses for generation, `/audio/speech` for TTS);
 * `openai-compatible` is any server that speaks Chat Completions, for generation only.
 */
export const ProviderType = Schema.Literals(['openai', 'openai-compatible']);
export type ProviderType = typeof ProviderType.Type;

/** How a provider is reached. Shared by every section that uses the provider. */
export const ConnectionSection = Schema.Struct({
  /** Base URL of the API, e.g. `https://api.openai.com/v1`. Defaults to OpenAI's. */
  baseUrl: Schema.optionalKey(Schema.NonEmptyString),
  /** The environment variable holding the key. Defaults to `defaultApiKeyEnv[type]`. */
  apiKeyEnv: Schema.optionalKey(Schema.NonEmptyString),
});
export type ConnectionSection = typeof ConnectionSection.Type;

/** `providers`: one connection per provider type. An absent entry uses the defaults. */
export const ProvidersSection = Schema.Struct({
  openai: Schema.optionalKey(ConnectionSection),
  'openai-compatible': Schema.optionalKey(ConnectionSection),
});
export type ProvidersSection = typeof ProvidersSection.Type;

export const defaultApiKeyEnv: Readonly<Record<ProviderType, string>> = {
  openai: 'FLUIDCAST_OPENAI_API_KEY',
  'openai-compatible': 'FLUIDCAST_OPENAI_COMPATIBLE_API_KEY',
};

/** A resolved connection: the key read. */
export interface Connection {
  readonly baseUrl?: string;
  readonly apiKey: Redacted.Redacted<string>;
}
