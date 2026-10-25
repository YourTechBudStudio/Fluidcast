import { describe, expect, it } from 'vitest';

import { copyFor, statusText } from './copy';

describe('thinking copy', () => {
  it('is one word for every kind of thinking', () => {
    expect(copyFor('thinking', 0)).toBe('Thinking');
    expect(copyFor('thinking', 3)).toBe('Thinking');
  });
});

describe('paused status text', () => {
  it('leads the lines the pause holds with Paused, in their paused wording', () => {
    const paused = { paused: true, fault: null };
    expect(statusText('paused', 0, paused)).toBe('Paused');
    expect(statusText('thinking', 0, paused)).toBe('Paused · Still thinking');
    expect(statusText('asking', 0, paused)).toBe('Paused · Question open');
    expect(statusText('complete', 0, paused)).toBe('Paused · Your turn.');
    expect(statusText('workerFinished', 0, paused)).toBe(
      'Paused · The worker finished. Play to hear it.',
    );
  });

  it('leaves failures and the connection in their own words', () => {
    const paused = { paused: true, fault: null };
    expect(statusText('generationFailed', 0, paused)).toBe(copyFor('generationFailed', 0));
    expect(statusText('reconnecting', 0, paused)).toBe(copyFor('reconnecting', 0));
  });

  it('is the moment’s own line when not paused', () => {
    expect(statusText('thinking', 0, { paused: false, fault: null })).toBe('Thinking');
  });
});
