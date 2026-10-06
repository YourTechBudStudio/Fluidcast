import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

import { Effect, FileSystem, Schema } from 'effect';

/** Where the ChatGPT sign-in lives: one file per user, shared by every checkout and worktree. */
export const credentialsPath = (homeDirectory: string): string =>
  join(homeDirectory, '.fluidcast', 'chatgpt-auth.json');

/**
 * The ChatGPT sign-in, the single source of truth for it. `pnpm chatgpt:login` writes it; the
 * backend reads it before each request and writes it back after a refresh.
 */
export const ChatGptCredentials = Schema.Struct({
  /** Identifies this installation to OpenAI; kept across sign-ins. */
  hostId: Schema.NonEmptyString,
  /** The client ID OpenAI issued at sign-in; refreshes use it. */
  clientId: Schema.NonEmptyString,
  accessToken: Schema.NonEmptyString,
  refreshToken: Schema.NonEmptyString,
  /** When the access token expires, in epoch milliseconds. */
  expiresAt: Schema.Finite,
  /** The signed-in account, for display only. */
  email: Schema.optionalKey(Schema.NonEmptyString),
});
export type ChatGptCredentials = typeof ChatGptCredentials.Type;

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(ChatGptCredentials));

/**
 * The credential file could not be read: `Missing` when there is no file, `Invalid` when it cannot
 * be read or decoded. Never carries the file's contents.
 */
export class CredentialsReadError extends Schema.TaggedError<CredentialsReadError>()(
  'CredentialsReadError',
  { path: Schema.String, reason: Schema.Literals(['Missing', 'Invalid']) },
) {}

/** The credential file could not be written. Never carries the credentials. */
export class CredentialsWriteError extends Schema.TaggedError<CredentialsWriteError>()(
  'CredentialsWriteError',
  { path: Schema.String },
) {}

export const readCredentials = (
  path: string,
): Effect.Effect<ChatGptCredentials, CredentialsReadError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const fail = (reason: 'Missing' | 'Invalid') =>
      Effect.fail(new CredentialsReadError({ path, reason }));
    if (!(yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false)))) {
      return yield* fail('Missing');
    }
    const text = yield* fs.readFileString(path).pipe(Effect.catch(() => fail('Invalid')));
    return yield* decode(text).pipe(Effect.catch(() => fail('Invalid')));
  });

/**
 * Replaces the credential file atomically: the directory is created private (`0700`) if absent,
 * the credentials go to a private (`0600`) sibling temp file, which is then renamed over the file.
 */
export const writeCredentials = (
  path: string,
  credentials: ChatGptCredentials,
): Effect.Effect<void, CredentialsWriteError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const temporary = `${path}.${randomUUID()}.tmp`;
    yield* fs.makeDirectory(dirname(path), { recursive: true, mode: 0o700 });
    yield* fs.writeFileString(temporary, `${JSON.stringify(credentials, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    yield* fs
      .rename(temporary, path)
      .pipe(Effect.tapError(() => fs.remove(temporary).pipe(Effect.ignore)));
  }).pipe(Effect.mapError(() => new CredentialsWriteError({ path })));
