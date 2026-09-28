import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { claudeWorker } from './index.ts';

describe('claudeWorker', () => {
  const { composeMessage } = claudeWorker({ description: 'Claude Code', cwd: '/work' });

  it('leaves the prompt unchanged without modifiers', () => {
    assert.equal(composeMessage('Plan it.', []), 'Plan it.');
  });

  it('chains modifiers ahead of the prompt', () => {
    assert.equal(
      composeMessage('Plan it.', [{ name: 'brainstorm' }, { name: 'plugin:review_2' }]),
      '/brainstorm /plugin:review_2 Plan it.',
    );
  });

  it('throws for more than six modifiers or an invalid name', () => {
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({ name }));
    assert.throws(() => composeMessage('Plan it.', seven));
    assert.doesNotThrow(() => composeMessage('Plan it.', seven.slice(0, 6)));
    for (const name of ['', 'Brainstorm', '-x', 'two words', '/slash']) {
      assert.throws(() => composeMessage('Plan it.', [{ name }]), name);
    }
  });
});

describe('Claude Agent SDK', () => {
  it('loads on this Node version with the functions the adapter uses', async () => {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    for (const name of [
      'query',
      'getSessionInfo',
      'getSessionMessages',
      'listSubagents',
      'getSubagentMessages',
      'forkSession',
    ] as const) {
      assert.equal(typeof sdk[name], 'function', name);
    }
  });
});
