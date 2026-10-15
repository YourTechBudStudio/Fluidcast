/// <reference types="node" />
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Effect, Exit, Stream } from 'effect';

import { SpawnFailed, openAppServer, openProcess } from './process.ts';

/** A real, short-lived Node process this test owns, running `script`. */
const node = (script: string, exitWait: number) =>
  openProcess({
    command: process.execPath,
    args: ['-e', script],
    environment: { PATH: process.env['PATH'] },
    exitWait,
  });

/** Echoes each stdin line; writes `closed` to the marker file and exits when stdin ends. */
const echo = `
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', (line) => process.stdout.write('echo ' + line + '\\n'));
rl.on('close', () => { require('node:fs').writeFileSync(process.argv[1], 'closed'); process.exit(0); });
`;

describe('openProcess', () => {
  it('carries lines both ways, and its release closes stdin so the process exits by itself', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluidcast-codex-'));
    after(() => rm(directory, { recursive: true, force: true }));
    const marker = join(directory, 'marker');
    const started = Date.now();
    const lines = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* openProcess({
            command: process.execPath,
            args: ['-e', echo, marker],
            environment: { PATH: process.env['PATH'] },
            exitWait: 5000,
          });
          yield* transport.write('one');
          return yield* transport.lines.pipe(Stream.take(1), Stream.runCollect);
        }),
      ),
    );
    assert.deepEqual(lines, ['echo one']);
    // Closing stdin, not a signal, ended it: the process saw the end of its input.
    assert.equal(await readFile(marker, 'utf8'), 'closed');
    assert.ok(Date.now() - started < 5000);
  });

  it('sends SIGTERM when the process ignores the end of stdin past the wait', async () => {
    const started = Date.now();
    let pid = 0;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* node(
            "process.stdin.resume(); process.stdin.on('end', () => {}); process.stdout.write(process.pid + '\\n'); setInterval(() => {}, 1000);",
            200,
          );
          const [line] = yield* transport.lines.pipe(Stream.take(1), Stream.runCollect);
          pid = Number(line);
        }),
      ),
    );
    assert.ok(Date.now() - started >= 200);
    // Give the signal a moment to land, then check the process is gone.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.throws(() => process.kill(pid, 0));
  });

  it('ends its lines when the process exits', async () => {
    const lines = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* node("process.stdout.write('bye\\n'); process.exit(0);", 1000);
          return yield* Stream.runCollect(transport.lines);
        }),
      ),
    );
    assert.deepEqual(lines, ['bye']);
  });

  it('fails with SpawnFailed when the command does not exist', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        openProcess({
          command: 'fluidcast-no-such-command',
          args: [],
          environment: { PATH: '/nonexistent' },
          exitWait: 100,
        }),
      ),
    );
    assert.deepEqual(exit, Exit.fail(new SpawnFailed()));
  });
});

describe('openAppServer', () => {
  /** A fake `codex` in its own directory that prints each argument on its own line, then exits. */
  let directory = '';
  let executable = '';
  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'fluidcast-codex-'));
    executable = join(directory, 'codex');
    await writeFile(executable, '#!/bin/sh\nprintf \'%s\\n\' "$@"\n');
    await chmod(executable, 0o755);
  });
  after(() => rm(directory, { recursive: true, force: true }));

  const argumentsOf = (transport: ReturnType<typeof openAppServer>) =>
    Effect.runPromise(
      Effect.scoped(transport.pipe(Effect.flatMap((open) => Stream.runCollect(open.lines)))),
    );

  it('runs `codex app-server` over stdio from PATH by default', async () => {
    assert.deepEqual(await argumentsOf(openAppServer({ PATH: directory })), [
      'app-server',
      '--listen',
      'stdio://',
    ]);
  });

  it('places host arguments around the subcommand, with the given executable', async () => {
    const launched = openAppServer(
      { PATH: '/nonexistent' },
      {
        executable,
        beforeSubcommand: ['--dangerously-bypass-hook-trust'],
        appServer: ['--enable', 'hooks', '-c', 'key=value'],
      },
    );
    assert.deepEqual(await argumentsOf(launched), [
      '--dangerously-bypass-hook-trust',
      'app-server',
      '--listen',
      'stdio://',
      '--enable',
      'hooks',
      '-c',
      'key=value',
    ]);
  });
});
