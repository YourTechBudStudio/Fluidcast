/// <reference types="node" />
/**
 * One `codex app-server --listen stdio://` process as a line transport, scoped. `node:child_process`
 * rather than Effect's process module, which needs a platform layer and kills with SIGTERM then
 * SIGKILL: SIGKILL orphans the commands Codex runs. Internal.
 */
import { spawn as spawnChild, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

import { Data, Effect, Stream, type Scope } from 'effect';

/** JSON-RPC lines in and out of one app-server process. */
export interface Transport {
  /** Stdout, one line at a time. Ends when stdout ends: the process exited or crashed. */
  readonly lines: Stream.Stream<string>;
  /** Writes one line to stdin. Lost silently once the process is gone (`lines` then ends). */
  readonly write: (line: string) => Effect.Effect<void>;
}

/** An app-server process for as long as the scope lives. */
export type OpenTransport = Effect.Effect<Transport, SpawnFailed, Scope.Scope>;

/** The app-server process could not be started (e.g. `codex` is not on `PATH`). */
export class SpawnFailed extends Data.TaggedError('SpawnFailed') {}

export interface ProcessOptions {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** The whole process environment: it replaces the parent's. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** How long the release waits for an exit after closing stdin before sending SIGTERM. */
  readonly exitWait: number;
}

const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

/**
 * Closes stdin, which makes the app-server stop its running commands and exit, then waits up to
 * `exitWait` milliseconds for the exit; after that, SIGTERM and no further wait. Never SIGKILL.
 */
const stop = (child: ChildProcess, exitWait: number) =>
  Effect.callback<void>((resume) => {
    if (exited(child)) return resume(Effect.void);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resume(Effect.void);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish();
    }, exitWait);
    child.once('exit', finish);
    child.stdin?.end();
  });

/** Starts a process and owns it for the scope. */
export const openProcess = (options: ProcessOptions): OpenTransport =>
  Effect.acquireRelease(
    Effect.callback<ChildProcess, SpawnFailed>((resume) => {
      const child = spawnChild(options.command, [...options.args], {
        env: options.environment,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      // Later errors (a write after exit) surface as the end of stdout instead.
      child.stdin?.on('error', () => {});
      child.once('spawn', () => resume(Effect.succeed(child)));
      child.once('error', () => resume(Effect.fail(new SpawnFailed())));
    }),
    (child) => stop(child, options.exitWait),
  ).pipe(
    Effect.map((child): Transport => ({
      lines: Stream.fromAsyncIterable(
        createInterface({ input: child.stdout!, crlfDelay: Infinity }),
        () => undefined,
      ).pipe(Stream.ignore),
      write: (line) =>
        Effect.sync(() => {
          if (child.stdin?.writable === true) child.stdin.write(`${line}\n`);
        }),
    })),
  );

/** The user's installed Codex app-server, found on `PATH`, over stdio. */
export const openAppServer = (
  environment: Readonly<Record<string, string | undefined>>,
): OpenTransport =>
  openProcess({
    command: 'codex',
    args: ['app-server', '--listen', 'stdio://'],
    environment,
    exitWait: 3000,
  });
