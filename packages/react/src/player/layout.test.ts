import { describe, expect, it } from 'vitest';

import { layoutFor } from './layout';

describe('layoutFor', () => {
  it('is compact below 640 px', () => {
    expect(layoutFor(639).compact).toBe(true);
    expect(layoutFor(640).compact).toBe(false);
  });

  it('shows the panel only from 734 px, where it fits', () => {
    expect(layoutFor(639).show).toBe('sheet');
    expect(layoutFor(640).show).toBe('sheet');
    expect(layoutFor(733).show).toBe('sheet');
    expect(layoutFor(734).show).toBe('panel');
    expect(layoutFor(1440).show).toBe('panel');
  });
});
