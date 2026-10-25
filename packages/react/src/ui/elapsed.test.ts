import { describe, expect, it } from 'vitest';

import { formatElapsed } from './elapsed';

describe('formatElapsed', () => {
  it('reads minutes and seconds, and hours past an hour', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(999)).toBe('0:00');
    expect(formatElapsed(83_000)).toBe('1:23');
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe('59:59');
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_600_000 + 5 * 60_000 + 7_000)).toBe('1:05:07');
  });

  it('clamps a negative duration to zero', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});
