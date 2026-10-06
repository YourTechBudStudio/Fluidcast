import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect } from 'effect';

import {
  type ChatGptCredentials,
  credentialsPath,
  readCredentials,
  writeCredentials,
} from './credentials.ts';

const directories: Array<string> = [];
after(() => directories.forEach((directory) => rmSync(directory, { recursive: true })));

/** A fresh home directory; the credential file's own directory does not exist yet. */
const home = () => {
  const directory = mkdtempSync(join(tmpdir(), 'fluidcast-credentials-'));
  directories.push(directory);
  return directory;
};

const credentials: ChatGptCredentials = {
  hostId: 'host',
  clientId: 'client',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 1_700_000_000_000,
  email: 'someone@example.com',
};

const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) =>
  Effect.runPromise(effect.pipe(Effect.result, Effect.provide(NodeServices.layer)));

const mode = (path: string) => statSync(path).mode & 0o777;

describe('ChatGPT credentials', () => {
  it('round-trips, creating a private directory and a private file', async () => {
    const path = credentialsPath(home());
    assert.equal((await run(writeCredentials(path, credentials)))._tag, 'Success');
    const read = await run(readCredentials(path));
    assert.equal(read._tag, 'Success');
    assert.deepEqual(read.success, credentials);
    assert.equal(mode(path), 0o600);
    assert.equal(mode(dirname(path)), 0o700);
  });

  it('replaces an existing file, leaving no temporary files behind', async () => {
    const path = credentialsPath(home());
    await run(writeCredentials(path, credentials));
    const replacement = { ...credentials, accessToken: 'access-2', refreshToken: 'refresh-2' };
    assert.equal((await run(writeCredentials(path, replacement)))._tag, 'Success');
    const read = await run(readCredentials(path));
    assert.equal(read._tag, 'Success');
    assert.deepEqual(read.success, replacement);
    assert.equal(mode(path), 0o600);
    assert.deepEqual(readdirSync(dirname(path)), ['chatgpt-auth.json']);
  });

  it('tells a missing file from an invalid one', async () => {
    const path = credentialsPath(home());
    const missing = await run(readCredentials(path));
    assert.equal(missing._tag, 'Failure');
    assert.equal(missing.failure.reason, 'Missing');

    await run(writeCredentials(path, credentials));
    writeFileSync(path, JSON.stringify({ ...credentials, accessToken: '' }));
    const invalid = await run(readCredentials(path));
    assert.equal(invalid._tag, 'Failure');
    assert.equal(invalid.failure.reason, 'Invalid');

    writeFileSync(path, 'not json');
    const garbage = await run(readCredentials(path));
    assert.equal(garbage._tag, 'Failure');
    assert.equal(garbage.failure.reason, 'Invalid');
    // The error names the file, never its contents.
    assert.doesNotMatch(String(garbage.failure), /not json/);
  });
});
