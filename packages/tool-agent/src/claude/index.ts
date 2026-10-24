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

import { modifierName, type Modifier } from '../handoff.ts';
import type { WorkerType } from '../worker.ts';
import { attachWith } from './attach.ts';
import { connectWith, type ConnectOptions } from './connect.ts';
import { listSkillsWith } from './skills.ts';

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
  /**
   * A settings file passed to this worker's query only, for per-invocation host instrumentation
   * (e.g. hooks that report the session to the host) without touching user or project settings.
   * Default: none.
   */
  readonly settings?: string;
}

/** One skill or command per message, for now: chaining several is not supported. */
const maxModifiers = 1;

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
  // No space before an empty prompt or one that starts on a new line.
  const separator = /^(\s|$)/.test(prompt) ? '' : ' ';
  return `/${modifier.name}${separator}${prompt}`;
};

/** The Claude Code worker: one long-lived streaming-input query. */
export const claudeWorker = (options: ClaudeWorkerOptions): WorkerType => {
  const connectOptions: ConnectOptions = {
    executable: options.executable,
    model: options.model,
    effort: options.effort,
    permissionMode: options.permissionMode,
    environment: options.environment ?? process.env,
    settings: options.settings,
  };
  return {
    cwd: options.cwd,
    composeMessage,
    attach: attachWith(
      { getSessionInfo, getSessionMessages, listSubagents, getSubagentMessages },
      options.cwd,
    ),
    connect: connectWith(query, connectOptions),
    // Same executable, environment, settings and setting sources as the worker.
    listSkills: listSkillsWith(query, connectOptions),
  };
};
