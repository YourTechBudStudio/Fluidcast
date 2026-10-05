import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SDKSessionInfo, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { Effect, Exit } from 'effect';

import { WorkerSetupError } from '../worker.ts';
import { attachWith, type SessionStore } from './attach.ts';
import { stored, toolUse } from './frames.test.ts';

const info = (cwd?: string): SDKSessionInfo => ({
  sessionId: 'session',
  summary: 'An invented session',
  lastModified: 0,
  ...(cwd === undefined ? {} : { cwd }),
});

/** A session store over invented history; records the directory each read used. */
const store = (options: {
  readonly info: SDKSessionInfo | undefined;
  readonly main?: ReadonlyArray<SessionMessage>;
  readonly subagents?: Readonly<Record<string, ReadonlyArray<SessionMessage>>>;
  readonly failMessages?: boolean;
}) => {
  const dirs: Array<string | undefined> = [];
  const sessions: SessionStore = {
    getSessionInfo: async () => options.info,
    getSessionMessages: async (_id, read) => {
      dirs.push(read?.dir);
      if (options.failMessages === true) throw new Error('unreadable');
      return [...(options.main ?? [])];
    },
    listSubagents: async (_id, read) => {
      dirs.push(read?.dir);
      return Object.keys(options.subagents ?? {});
    },
    getSubagentMessages: async (_id, agentId, read) => {
      dirs.push(read?.dir);
      return [...(options.subagents?.[agentId] ?? [])];
    },
  };
  return { sessions, dirs };
};

describe('attach', () => {
  it('reads the recorded directory and the history with subagents nested', async () => {
    const fake = store({
      info: info('/recorded'),
      main: [stored('user', 'Start.'), stored('assistant', [toolUse('call_a', 'Agent')])],
      subagents: { sub1: [stored('user', 'Explore.', 'call_a')] },
    });
    const attached = await Effect.runPromise(attachWith(fake.sessions, '/configured')('session'));
    assert.equal(attached.cwd, '/recorded');
    assert.deepEqual(
      attached.history.map((entry) => [entry._tag, entry.parentToolUseId]),
      [
        ['prompt', null],
        ['toolCall', null],
        ['prompt', 'call_a'],
      ],
    );
    assert.deepEqual(fake.dirs, ['/recorded', '/recorded', '/recorded']);
  });

  it('falls back to the configured directory', async () => {
    const attached = await Effect.runPromise(
      attachWith(store({ info: info() }).sessions, '/configured')('session'),
    );
    assert.equal(attached.cwd, '/configured');
  });

  it('fails SessionNotFound for an unknown session and SessionUnreadable for a failed read', async () => {
    assert.deepEqual(
      await Effect.runPromise(
        Effect.exit(attachWith(store({ info: undefined }).sessions, '/c')('session')),
      ),
      Exit.fail(new WorkerSetupError({ sessionId: 'session', reason: 'SessionNotFound' })),
    );
    assert.deepEqual(
      await Effect.runPromise(
        Effect.exit(
          attachWith(store({ info: info(), failMessages: true }).sessions, '/c')('session'),
        ),
      ),
      Exit.fail(new WorkerSetupError({ sessionId: 'session', reason: 'SessionUnreadable' })),
    );
  });
});
