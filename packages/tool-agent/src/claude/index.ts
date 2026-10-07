/// <reference types="node" />
/**
 * The Claude Code worker type, over `@anthropic-ai/claude-agent-sdk` (an optional peer: only
 * applications that import this entry load it).
 */
import {
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSubagents,
  query,
  type EffortLevel,
  type PermissionMode,
} from '@anthropic-ai/claude-agent-sdk';

import type { Modifier } from '../handoff.ts';
import type { WorkerType } from '../worker.ts';
import { attachWith } from './attach.ts';
import { connectWith } from './connect.ts';

export interface ClaudeWorkerOptions {
  /** Where a new worker runs. A preloaded worker runs in its session's recorded directory. */
  readonly cwd: string;
  /**
   * The installed `claude` executable, as an absolute path (the SDK checks it exists). Required: the
   * worker never runs the SDK's bundled Claude Code.
   */
  readonly executable: string;
  readonly model?: string;
  readonly effort?: EffortLevel;
  /** Default `'auto'`. */
  readonly permissionMode?: PermissionMode;
  /** The worker process environment. Default `process.env`. The SDK replaces, never merges. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/** One skill or command per message, for now: chaining several is not supported. */
const maxModifiers = 1;
const modifierName = /^[a-z0-9][a-z0-9:_-]*$/;

/**
 * Claude Code recognises a command or skill only at the start of a message, as `/name <prompt>`:
 * the modifier receives the whole prompt as its arguments.
 */
const composeMessage = (prompt: string, modifiers: ReadonlyArray<Modifier>): string => {
  const [modifier] = modifiers;
  if (modifier === undefined) return prompt;
  if (modifiers.length > maxModifiers) {
    throw new Error(`Claude Code takes at most ${maxModifiers} modifier, got ${modifiers.length}`);
  }
  if (!modifierName.test(modifier.name)) throw new Error('Invalid Claude Code modifier name');
  return `/${modifier.name} ${prompt}`;
};

/** The Claude Code worker: one long-lived streaming-input query. */
export const claudeWorker = (options: ClaudeWorkerOptions): WorkerType => ({
  cwd: options.cwd,
  composeMessage,
  attach: attachWith(
    { getSessionInfo, getSessionMessages, listSubagents, getSubagentMessages },
    options.cwd,
  ),
  connect: connectWith(query, {
    executable: options.executable,
    model: options.model,
    effort: options.effort,
    permissionMode: options.permissionMode,
    environment: options.environment ?? process.env,
  }),
});
