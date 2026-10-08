/**
 * Signs in to ChatGPT once and saves the sign-in for the backend's `chatgpt` LLM provider.
 * Usage: `pnpm chatgpt:login`. Running it again replaces the previous sign-in.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';

import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { Console, Data, Deferred, Duration, Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';

import { credentialsPath, readCredentials, writeCredentials } from './chatgpt/credentials.ts';
import * as OAuth from './chatgpt/oauth.ts';

/** A sign-in failure, with the one line printed for it. */
class LoginError extends Data.TaggedError('LoginError')<{ readonly message: string }> {}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** The page the browser shows after the redirect. `message` may echo OpenAI's error code. */
const page = (message: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Fluidcast</title></head><body style="font-family: system-ui, sans-serif; margin: 3rem;"><p>${escapeHtml(message)}</p></body></html>`;

/**
 * Listens for OpenAI's redirect on the callback port until the scope closes, completing `callback`
 * with the result of the first callback that carries this attempt's `state`.
 */
const callbackServer = (
  callback: Deferred.Deferred<
    { readonly code: string; readonly clientId: string },
    OAuth.OAuthError
  >,
  state: string,
) =>
  Effect.acquireRelease(
    Effect.callback<Server, LoginError>((resume) => {
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', `http://${OAuth.callbackHost}`);
        if (url.pathname !== OAuth.callbackPath) {
          response.writeHead(404).end();
          return;
        }
        // Only this attempt's redirect settles it; a stale or unrelated one is answered and ignored.
        if (url.searchParams.get('state') !== state) {
          response
            .writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
            .end(page('This sign-in link is not the one in progress. Use the latest link.'));
          return;
        }
        const outcome = Effect.runSync(
          OAuth.parseCallback(url, state).pipe(
            Effect.tap((result) => Deferred.succeed(callback, result)),
            Effect.as({
              status: 200,
              message: 'Sign-in received. Return to your terminal to finish.',
            }),
            Effect.catch((error) =>
              Deferred.fail(callback, error).pipe(
                Effect.as({ status: 400, message: `Sign-in failed: ${error.message}` }),
              ),
            ),
          ),
        );
        response
          .writeHead(outcome.status, { 'content-type': 'text/html; charset=utf-8' })
          .end(page(outcome.message));
      });
      server.once('error', (error: NodeJS.ErrnoException) =>
        resume(
          Effect.fail(
            new LoginError({
              message:
                error.code === 'EADDRINUSE'
                  ? `Port ${OAuth.callbackPort} is busy, probably another sign-in (Codex, Toph) is running. Close it and run pnpm chatgpt:login again.`
                  : `Could not start the sign-in callback server (${error.code ?? 'unknown error'}).`,
            }),
          ),
        ),
      );
      server.listen(OAuth.callbackPort, OAuth.callbackHost, () => resume(Effect.succeed(server)));
    }),
    (server) =>
      Effect.sync(() => {
        server.close();
        // Browsers keep the callback connection alive; without this, close() waits on it.
        server.closeAllConnections();
      }),
  );

/** Opens `url` in the default browser, best effort. */
const openBrowser = (url: string) =>
  Effect.sync(() => {
    const [command, args] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '""', url]]
          : ['xdg-open', [url]];
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
    } catch {
      // The URL is printed; the user can open it themselves.
    }
  });

const login = Effect.gen(function* () {
  const path = credentialsPath(homedir());
  const hostId = yield* readCredentials(path).pipe(
    Effect.map((existing) => existing.hostId),
    Effect.orElseSucceed(() => randomUUID()),
  );
  const verifier = OAuth.randomToken();
  const state = OAuth.randomToken();
  const url = OAuth.authorizationUrl({
    hostId,
    state,
    nonce: OAuth.randomToken(),
    challenge: OAuth.codeChallenge(verifier),
  });

  const callback = yield* Deferred.make<
    { readonly code: string; readonly clientId: string },
    OAuth.OAuthError
  >();
  const { code, clientId } = yield* Effect.scoped(
    Effect.gen(function* () {
      yield* callbackServer(callback, state);
      yield* Console.log(`Open this URL to sign in to ChatGPT:\n\n${url}\n`);
      yield* openBrowser(url);
      return yield* Deferred.await(callback).pipe(
        Effect.timeoutOrElse({
          duration: Duration.minutes(5),
          orElse: () =>
            Effect.fail(
              new LoginError({ message: 'Sign-in timed out. Run pnpm chatgpt:login again.' }),
            ),
        }),
      );
    }),
  );

  const tokens = yield* OAuth.exchangeCode({ code, verifier, clientId });
  yield* writeCredentials(path, { hostId, clientId, ...tokens }).pipe(
    Effect.mapError(() => new LoginError({ message: `Could not save the sign-in to ${path}.` })),
  );
  yield* Console.log(
    tokens.email === undefined
      ? `Signed in to ChatGPT. Saved to ${path}.`
      : `Signed in to ChatGPT as ${tokens.email}. Saved to ${path}.`,
  );
});

login.pipe(
  Effect.catch((error) =>
    Effect.andThen(
      Console.error(error.message),
      Effect.sync(() => (process.exitCode = 1)),
    ),
  ),
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  NodeRuntime.runMain,
);
