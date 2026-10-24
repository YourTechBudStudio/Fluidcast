import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { codexWorker } from './index.ts';

describe('codexWorker', () => {
  const { composeMessage } = codexWorker({ cwd: '/work', environment: {} });

  it('leaves the prompt unchanged without modifiers', () => {
    assert.equal(composeMessage('Plan it.', []), 'Plan it.');
  });

  it('names its one modifier as a skill ahead of the prompt', () => {
    assert.equal(
      composeMessage('Plan it.', [{ name: 'plugin:review_2' }]),
      '$plugin:review_2 Plan it.',
    );
  });

  it('writes the bare modifier for an empty prompt, and no space before a new line', () => {
    assert.equal(composeMessage('', [{ name: 'shaping-issues' }]), '$shaping-issues');
    assert.equal(
      composeMessage('\n- Do it.', [{ name: 'shaping-issues' }]),
      '$shaping-issues\n- Do it.',
    );
  });

  it('throws for more than one modifier or an invalid name', () => {
    assert.throws(
      () => composeMessage('Plan it.', [{ name: 'brainstorm' }, { name: 'review' }]),
      /at most 1 modifier, got 2/,
    );
    for (const name of ['', 'Brainstorm', '-x', 'two words', '$dollar']) {
      assert.throws(() => composeMessage('Plan it.', [{ name }]), name);
    }
  });
});
