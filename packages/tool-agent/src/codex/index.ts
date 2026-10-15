/// <reference types="node" />
/**
 * The Codex worker type, over the user's installed `codex app-server` (JSON-RPC over stdio), found
 * on `PATH`. No version is pinned or checked.
 */
import type { Effect } from 'effect';

import type { Modifier } from '../handoff.ts';
import type { WorkerSetupError, WorkerType } from '../worker.ts';
import { attachWith, readThreadWith, type CodexThread } from './attach.ts';
import { connectWith, type CodexThreadOptions } from './connect.ts';
import { defaultAppServerLaunch, openAppServer, type AppServerLaunch } from './process.ts';

export type { CodexThread } from './attach.ts';
export type { CodexThreadOptions } from './connect.ts';

/**
 * How a Codex app-server is launched, for a worker's connection, attach and Continue read alike.
 * Pass the same launch to `codexWorker` and `readCodexThread`: each opens its own app-server.
 */
export interface CodexLaunchOptions {
  /** The app-server process environment. Default `process.env`. It replaces, never merges. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** The `codex` executable, resolved on the environment's `PATH` when not absolute. Default `codex`. */
  readonly executable?: string;
  /**
   * Extra app-server arguments for per-invocation host instrumentation (e.g. enabling hooks and
   * registering them with `-c` overrides), without touching the user's Codex configuration. They
   * apply to the whole process, so attach and Continue reads get them too; those start no turn, so
   * hooks never fire for them. Settings Codex honors only per thread go in the worker's `thread`.
   * Default: none.
   */
  readonly args?: {
    /** Before the `app-server` subcommand, e.g. global flags. */
    readonly beforeSubcommand?: ReadonlyArray<string>;
    /** After `app-server --listen stdio://`. The transport is fixed: never pass `--listen`. */
    readonly appServer?: ReadonlyArray<string>;
  };
}

export interface CodexWorkerOptions extends CodexLaunchOptions {
  /** Where a new worker runs. A preloaded worker runs in its thread's recorded directory. */
  readonly cwd: string;
  /** A new thread's model; default: Codex's. A resumed thread keeps its recorded model. */
  readonly model?: string;
  /** Reasoning effort, sent with every message; levels vary by model. Default: the thread's. */
  readonly effort?: string;
  /**
   * Per-thread options for per-invocation host instrumentation: settings Codex honors only per
   * thread, which process-wide `args` cannot set. Default: none.
   */
  readonly thread?: CodexThreadOptions;
}

/** One app-server opener for a worker's connection, attach and read alike. */
const appServer = (options: CodexLaunchOptions) => {
  const launch: AppServerLaunch = {
    executable: options.executable ?? defaultAppServerLaunch.executable,
    beforeSubcommand: options.args?.beforeSubcommand ?? defaultAppServerLaunch.beforeSubcommand,
    appServer: options.args?.appServer ?? defaultAppServerLaunch.appServer,
  };
  return openAppServer(options.environment ?? process.env, launch);
};

/** One skill per message, for now: chaining several is not supported. */
const maxModifiers = 1;
const modifierName = /^[a-z0-9][a-z0-9:_-]*$/;

/** Codex invokes a skill named in the text as `$name`; the skill receives the whole prompt. */
const composeMessage = (prompt: string, modifiers: ReadonlyArray<Modifier>): string => {
  const [modifier] = modifiers;
  if (modifier === undefined) return prompt;
  if (modifiers.length > maxModifiers) {
    throw new Error(`Codex takes at most ${maxModifiers} modifier, got ${modifiers.length}`);
  }
  if (!modifierName.test(modifier.name)) throw new Error('Invalid Codex modifier name');
  return `$${modifier.name} ${prompt}`;
};

/**
 * The Codex worker: one app-server process per connection, in auto permission mode (approvals go
 * to Codex's reviewer; any request that still reaches Fluidcast is declined). The sandbox comes from
 * the user's Codex configuration.
 */
export const codexWorker = (options: CodexWorkerOptions): WorkerType => {
  const open = appServer(options);
  return {
    cwd: options.cwd,
    composeMessage,
    attach: attachWith(open),
    connect: connectWith(open, {
      model: options.model,
      effort: options.effort,
      thread: options.thread,
    }),
  };
};

/**
 * Reads a stored Codex thread for Continue: its recorded model and effort, and its last answer
 * (every agent message after the last user message). Starts a short-lived app-server from `options`,
 * which should be the launch the worker that continues it uses, and no turn. Any failure, including
 * an unknown thread, is `SessionUnreadable`.
 */
export const readCodexThread = (
  threadId: string,
  options: CodexLaunchOptions = {},
): Effect.Effect<CodexThread, WorkerSetupError> => readThreadWith(appServer(options))(threadId);
