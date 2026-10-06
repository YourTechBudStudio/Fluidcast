import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { claudeWorker } from './index.ts';

describe('claudeWorker', () => {
  const { composeMessage } = claudeWorker({ cwd: '/work' });

  it('leaves the prompt unchanged without modifiers', () => {
    assert.equal(composeMessage('Plan it.', []), 'Plan it.');
  });

  it('puts its one modifier ahead of the prompt', () => {
    assert.equal(
      composeMessage('Plan it.', [{ name: 'plugin:review_2' }]),
      '/plugin:review_2 Plan it.',
    );
  });

  it('throws for more than one modifier or an invalid name', () => {
    assert.throws(
      () => composeMessage('Plan it.', [{ name: 'brainstorm' }, { name: 'review' }]),
      /at most 1 modifier, got 2/,
    );
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
