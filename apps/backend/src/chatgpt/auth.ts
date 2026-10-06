import {
  Clock,
  Context,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Redacted,
  Schema,
  Semaphore,
} from 'effect';
import { HttpClient } from 'effect/unstable/http';

import { readCredentials, writeCredentials, type ChatGptCredentials } from './credentials.ts';
import * as OAuth from './oauth.ts';

/** How long before expiry an access token is refreshed. */
const refreshMargin = 5 * 60 * 1000;

/**
 * No valid ChatGPT access token. `NotSignedIn`: the credential file is missing or invalid.
 * `SignInExpired`: OpenAI rejected the refresh. `RefreshFailed`: the refresh could not complete.
 * Never carries a token.
 */
export class ChatGptAuthError extends Schema.TaggedError<ChatGptAuthError>()('ChatGptAuthError', {
  reason: Schema.Literals(['NotSignedIn', 'SignInExpired', 'RefreshFailed']),
}) {}

/**
 * Hands out a valid ChatGPT access token, refreshing it when needed. The credential file is the
 * single source of truth: it is read for every token, so a re-login or another backend's refresh
 * is picked up at once.
 */
export class ChatGptAuth extends Context.Service<
  ChatGptAuth,
  { readonly accessToken: Effect.Effect<Redacted.Redacted<string>, ChatGptAuthError> }
>()('fluidcast-backend/ChatGptAuth') {
  static readonly layer = (
    credentialsPath: string,
  ): Layer.Layer<ChatGptAuth, never, FileSystem.FileSystem | HttpClient.HttpClient> =>
    Layer.effect(ChatGptAuth, make(credentialsPath));
}

const make = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const http = yield* HttpClient.HttpClient;
    // Refreshes run in the service's own scope, not the requesting generation's.
    const scope = yield* Effect.scope;
    // One refresh at a time in this process.
    const refreshing = yield* Semaphore.make(1);

    const read = readCredentials(path).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.tapError(() => Effect.logError('ChatGPT is not signed in. Run pnpm chatgpt:login.')),
      Effect.mapError(() => new ChatGptAuthError({ reason: 'NotSignedIn' })),
    );
    const isFresh = (credentials: ChatGptCredentials) =>
      Effect.map(Clock.currentTimeMillis, (now) => credentials.expiresAt - now > refreshMargin);

    const renew = (credentials: ChatGptCredentials) =>
      Effect.gen(function* () {
        const tokens = yield* OAuth.refresh({
          clientId: credentials.clientId,
          refreshToken: credentials.refreshToken,
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
          Effect.catchTag('OAuthError', (error) =>
            error.reason === 'Rejected'
              ? Effect.andThen(
                  Effect.logError(
                    'ChatGPT sign-in expired or was revoked. Run pnpm chatgpt:login.',
                  ),
                  Effect.fail(new ChatGptAuthError({ reason: 'SignInExpired' })),
                )
              : Effect.andThen(
                  Effect.logError('Refreshing the ChatGPT sign-in failed.').pipe(
                    Effect.annotateLogs({ error: error._tag, reason: error.reason }),
                  ),
                  Effect.fail(new ChatGptAuthError({ reason: 'RefreshFailed' })),
                ),
          ),
        );
        const renewed: ChatGptCredentials = {
          ...credentials,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? credentials.refreshToken,
          expiresAt: tokens.expiresAt,
        };
        yield* writeCredentials(path, renewed).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.tapError((error) =>
            Effect.logError('Saving the refreshed ChatGPT sign-in failed.').pipe(
              Effect.annotateLogs({ error: error._tag }),
            ),
          ),
          Effect.mapError(() => new ChatGptAuthError({ reason: 'RefreshFailed' })),
        );
        return renewed;
      });

    const accessToken = Effect.gen(function* () {
      const current = yield* read;
      if (yield* isFresh(current)) return Redacted.make(current.accessToken);
      // OpenAI rotates the refresh token, so a refresh must not stop between the token request
      // and saving its result: it runs detached from this request, which only awaits it.
      const refresh = yield* refreshing
        .withPermits(1)(
          Effect.gen(function* () {
            // Read again: an earlier refresh, a re-login or another backend may have refreshed it
            // already.
            const latest = yield* read;
            if (yield* isFresh(latest)) return Redacted.make(latest.accessToken);
            return Redacted.make((yield* renew(latest)).accessToken);
          }),
        )
        .pipe(Effect.forkIn(scope));
      return yield* Fiber.join(refresh);
    });

    return ChatGptAuth.of({ accessToken });
  });
