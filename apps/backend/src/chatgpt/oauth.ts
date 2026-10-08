/**
 * OpenAI's official "Sign in with ChatGPT" for open-source apps: the sign-in URL, the callback, the
 * code exchange and the refresh. The tokens it issues authorize the normal OpenAI API against the
 * user's ChatGPT plan.
 */
import { createHash, randomBytes } from 'node:crypto';

import { Clock, Effect, Option, Schema } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';

const authorizeUrl = 'https://auth.openai.com/api/accounts/authorize';
const tokenUrl = 'https://auth.openai.com/api/accounts/oauth/token';
const resource = 'https://api.openai.com/v1';
/** OpenAI registers a client per sign-in and returns its ID in the callback. */
const dynamicClientId = 'dynamic_agent_client';
/** The name shown in the user's ChatGPT connected apps. */
const agentName = 'Fluidcast';
const scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const requiredScope = 'chatgpt.tokens.use.direct';

export const callbackHost = '127.0.0.1';
export const callbackPort = 1455;
export const callbackPath = '/auth/callback';
const redirectUri = `http://${callbackHost}:${callbackPort}${callbackPath}`;

const base64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** A random value for PKCE verifiers, `state` and `nonce`. */
export const randomToken = (): string => base64Url(randomBytes(32));

/** The PKCE S256 challenge for `verifier`. */
export const codeChallenge = (verifier: string): string =>
  base64Url(createHash('sha256').update(verifier).digest());

/** The URL that starts a sign-in in the browser. */
export const authorizationUrl = (options: {
  readonly hostId: string;
  readonly state: string;
  readonly nonce: string;
  readonly challenge: string;
}): string => {
  const url = new URL(authorizeUrl);
  url.search = new URLSearchParams({
    client_id: dynamicClientId,
    agent_name_hint: agentName,
    ext_agent_host_id: `urn:uuid:${options.hostId.toLowerCase()}`,
    response_type: 'code',
    redirect_uri: redirectUri,
    resource,
    scope,
    state: options.state,
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
    nonce: options.nonce,
  }).toString();
  return url.toString();
};

/**
 * The sign-in failed. `Rejected`: OpenAI refused it (an error callback, or the token endpoint
 * answered `400`/`401`, e.g. `invalid_grant`). `Failed`: a transport, protocol or unexpected
 * failure. `message` may carry OpenAI's error code, never a token.
 */
export class OAuthError extends Schema.TaggedError<OAuthError>()('OAuthError', {
  reason: Schema.Literals(['Rejected', 'Failed']),
  message: Schema.String,
}) {}

/** The authorization code and the issued client ID from the callback URL, after checking `state`. */
export const parseCallback = (
  url: URL,
  expectedState: string,
): Effect.Effect<{ readonly code: string; readonly clientId: string }, OAuthError> => {
  const parameter = (name: string) => url.searchParams.get(name) ?? '';
  const failed = (message: string) => Effect.fail(new OAuthError({ reason: 'Failed', message }));
  if (parameter('state') !== expectedState) {
    return failed('The sign-in callback did not match this sign-in (state).');
  }
  const error = parameter('error');
  if (error !== '') {
    return Effect.fail(
      new OAuthError({ reason: 'Rejected', message: `OpenAI refused the sign-in (${error}).` }),
    );
  }
  const code = parameter('code');
  if (code === '') return failed('The sign-in callback carried no authorization code.');
  const clientId = parameter('client_id');
  if (clientId === '') return failed('The sign-in callback carried no client ID.');
  return Effect.succeed({ code, clientId });
};

/** Tokens from the token endpoint. `expiresAt` is epoch milliseconds. */
export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: number;
  readonly email?: string;
}

const TokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  expires_in: Schema.Finite.check(Schema.isGreaterThan(0)),
  scope: Schema.String,
  refresh_token: Schema.optionalKey(Schema.NonEmptyString),
  id_token: Schema.optionalKey(Schema.NonEmptyString),
});
type TokenResponse = typeof TokenResponse.Type;

const ErrorResponse = Schema.Struct({ error: Schema.String });

/** Posts a form to the token endpoint and decodes the reply. Never includes tokens in errors. */
const requestTokens = (
  form: Record<string, string>,
): Effect.Effect<
  TokenResponse & { readonly expiresAt: number },
  OAuthError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    // Measured before the request, so the expiry errs early.
    const now = yield* Clock.currentTimeMillis;
    const response = yield* client.execute(
      HttpClientRequest.post(tokenUrl).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyUrlParams(form),
      ),
    );
    if (response.status === 400 || response.status === 401) {
      const code = yield* HttpClientResponse.schemaBodyJson(ErrorResponse)(response).pipe(
        Effect.map((body) => body.error),
        Effect.orElseSucceed(() => `HTTP ${response.status}`),
      );
      return yield* new OAuthError({
        reason: 'Rejected',
        message: `OpenAI rejected the token request (${code}).`,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* new OAuthError({
        reason: 'Failed',
        message: `The token endpoint answered HTTP ${response.status}.`,
      });
    }
    const body = yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response).pipe(
      Effect.mapError(
        () =>
          new OAuthError({ reason: 'Failed', message: 'The token response was not understood.' }),
      ),
    );
    if (!body.scope.split(' ').includes(requiredScope)) {
      return yield* new OAuthError({
        reason: 'Failed',
        message: `The issued token lacks the ${requiredScope} scope.`,
      });
    }
    return { ...body, expiresAt: now + body.expires_in * 1000 };
  }).pipe(
    Effect.catchTag('HttpClientError', (error) =>
      Effect.fail(
        new OAuthError({
          reason: 'Failed',
          message: `Could not reach OpenAI's token endpoint (${error.reason._tag}).`,
        }),
      ),
    ),
  );

/** Exchanges the callback's code, with the issued client ID, for tokens. */
export const exchangeCode = (options: {
  readonly code: string;
  readonly verifier: string;
  readonly clientId: string;
}): Effect.Effect<Tokens & { readonly refreshToken: string }, OAuthError, HttpClient.HttpClient> =>
  requestTokens({
    grant_type: 'authorization_code',
    client_id: options.clientId,
    code: options.code,
    code_verifier: options.verifier,
    redirect_uri: redirectUri,
    resource,
  }).pipe(
    Effect.flatMap((body) => {
      if (body.refresh_token === undefined || body.id_token === undefined) {
        return Effect.fail(
          new OAuthError({
            reason: 'Failed',
            message: 'The token response lacked a refresh or ID token.',
          }),
        );
      }
      const email = emailFromIdToken(body.id_token);
      return Effect.succeed({
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: body.expiresAt,
        ...(email === undefined ? {} : { email }),
      });
    }),
  );

/** Exchanges a refresh token for new tokens. `refreshToken` is absent when OpenAI kept the old one. */
export const refresh = (options: {
  readonly clientId: string;
  readonly refreshToken: string;
}): Effect.Effect<Tokens, OAuthError, HttpClient.HttpClient> =>
  requestTokens({
    grant_type: 'refresh_token',
    client_id: options.clientId,
    refresh_token: options.refreshToken,
    resource,
  }).pipe(
    Effect.map((body) => ({
      accessToken: body.access_token,
      ...(body.refresh_token === undefined ? {} : { refreshToken: body.refresh_token }),
      expiresAt: body.expiresAt,
    })),
  );

const IdTokenPayload = Schema.fromJsonString(
  Schema.Struct({ email: Schema.optionalKey(Schema.NonEmptyString) }),
);

/** The `email` claim of an ID token, for display only: the signature is not verified. */
const emailFromIdToken = (idToken: string): string | undefined => {
  const payload = idToken.split('.')[1];
  if (payload === undefined) return undefined;
  return Schema.decodeUnknownOption(IdTokenPayload)(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ).pipe(
    Option.flatMap((claims) => Option.fromUndefinedOr(claims.email)),
    Option.getOrUndefined,
  );
};
