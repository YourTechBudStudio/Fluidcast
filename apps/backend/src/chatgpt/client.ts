import * as OpenAiClient from '@effect/ai-openai/OpenAiClient';
import { Effect, type FileSystem, Layer, Redacted } from 'effect';
import { HttpClient, HttpClientError, HttpClientRequest } from 'effect/unstable/http';

import { ChatGptAuth } from './auth.ts';

/**
 * The `OpenAiClient` for the ChatGPT sign-in: OpenAI's API, authorized per request by the
 * signed-in user's access token, refreshed as needed. A missing or failed sign-in fails that
 * request as a transport error, so it reaches Core as an `AiError` without any secret.
 */
export const chatGptClientLayer = (
  credentialsPath: string,
): Layer.Layer<OpenAiClient.OpenAiClient, never, HttpClient.HttpClient | FileSystem.FileSystem> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const auth = yield* ChatGptAuth;
      return OpenAiClient.layer({
        transformClient: (client) =>
          client.pipe(
            HttpClient.mapRequestEffect((request) =>
              auth.accessToken.pipe(
                Effect.map((token) =>
                  HttpClientRequest.bearerToken(request, Redacted.value(token)),
                ),
                Effect.mapError(
                  (error) =>
                    new HttpClientError.HttpClientError({
                      reason: new HttpClientError.TransportError({
                        request,
                        description: `No ChatGPT access token (${error.reason}).`,
                      }),
                    }),
                ),
              ),
            ),
            HttpClient.tapError((error) => {
              if (error.reason._tag !== 'StatusCodeError') return Effect.void;
              switch (error.reason.response.status) {
                case 401:
                  return Effect.logError(
                    'ChatGPT sign-in expired or was revoked. Run pnpm chatgpt:login.',
                  );
                case 429:
                  return Effect.logWarning('ChatGPT plan usage limit reached (or rate limited).');
                default:
                  return Effect.void;
              }
            }),
          ),
      });
    }),
  ).pipe(Layer.provide(ChatGptAuth.layer(credentialsPath)));
