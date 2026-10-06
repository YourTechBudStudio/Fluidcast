/// <reference types="node" />
/**
 * The Codex worker type, over the user's installed `codex app-server` (JSON-RPC over stdio), found
 * on `PATH`. No version is pinned or checked.
 */
import type { Effect } from 'effect';

import type { Modifier } from '../handoff.ts';
import type { WorkerSetupError, WorkerType } from '../worker.ts';
import { attachWith, readThreadWith, type CodexThread } from './attach.ts';
import { connectWith } from './connect.ts';
import { openAppServer } from './process.ts';

export type { CodexThread } from './attach.ts';

export interface CodexWorkerOptions {
  /** Where a new worker runs. A preloaded worker runs in its thread's recorded directory. */
  readonly cwd: string;
  /** A new thread's model; default: Codex's. A resumed thread keeps its recorded model. */
  readonly model?: string;
  /** Reasoning effort, sent with every message; levels vary by model. Default: the thread's. */
  readonly effort?: string;
  /** The app-server process environment. Default `process.env`. It replaces, never merges. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

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
  const open = openAppServer(options.environment ?? process.env);
  return {
    cwd: options.cwd,
    composeMessage,
    attach: attachWith(open),
    connect: connectWith(open, { model: options.model, effort: options.effort }),
  };
};

/**
 * Reads a stored Codex thread for Continue: its recorded model and effort, and its last answer
 * (every agent message after the last user message). Starts a short-lived app-server, and no turn.
 * Any failure, including an unknown thread, is `SessionUnreadable`.
 */
export const readCodexThread = (
  threadId: string,
  options: { readonly environment?: Readonly<Record<string, string | undefined>> } = {},
): Effect.Effect<CodexThread, WorkerSetupError> =>
  readThreadWith(openAppServer(options.environment ?? process.env))(threadId);
