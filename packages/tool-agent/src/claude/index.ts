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
  /** The line the tool rules give this type. */
  readonly description: string;
  /** Where new workers run. A preloaded worker runs in its session's recorded directory. */
  readonly cwd: string;
  readonly model?: string;
  readonly effort?: EffortLevel;
  /** Default `'auto'`. */
  readonly permissionMode?: PermissionMode;
  /** The worker process environment. Default `process.env`. The SDK replaces, never merges. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/** Claude Code chains at most six skills at the start of a message. */
const maxModifiers = 6;
const modifierName = /^[a-z0-9][a-z0-9:_-]*$/;

/**
 * Claude Code recognises a command or skill only at the start of a message, and chains skills as
 * `/a /b <shared arguments>`: every modifier receives the whole prompt as its arguments.
 */
const composeMessage = (prompt: string, modifiers: ReadonlyArray<Modifier>): string => {
  if (modifiers.length === 0) return prompt;
  if (modifiers.length > maxModifiers) {
    throw new Error(
      `Claude Code chains at most ${maxModifiers} modifiers, got ${modifiers.length}`,
    );
  }
  for (const { name } of modifiers) {
    if (!modifierName.test(name)) throw new Error('Invalid Claude Code modifier name');
  }
  return `${modifiers.map(({ name }) => `/${name}`).join(' ')} ${prompt}`;
};

/** Claude Code workers: one long-lived streaming-input query per worker. */
export const claudeWorker = (options: ClaudeWorkerOptions): WorkerType => ({
  description: options.description,
  cwd: options.cwd,
  composeMessage,
  attach: attachWith(
    { getSessionInfo, getSessionMessages, listSubagents, getSubagentMessages },
    options.cwd,
  ),
  connect: connectWith(query, {
    model: options.model,
    effort: options.effort,
    permissionMode: options.permissionMode,
    environment: options.environment ?? process.env,
  }),
});
