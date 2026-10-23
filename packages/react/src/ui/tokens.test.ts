import { describe, expect, it } from 'vitest';

import { type Palette, toneCss, toneHex, toneRgb, UNRESOLVED_PALETTE } from './tokens';

const palette: Palette = {
  ...UNRESOLVED_PALETTE,
  hex: { ...UNRESOLVED_PALETTE.hex, canvas: '#000000', violet: '#ff8000' },
};

describe('tones', () => {
  it('resolves a palette colour to shader channels', () => {
    expect(toneRgb(palette, 'violet')).toEqual([1, 128 / 255, 0]);
  });

  it('blends two colours the given fraction of the way from the first', () => {
    expect(toneHex(palette, ['canvas', 'violet', 0.25])).toBe('#402000');
  });

  it('writes the same blend on the theme variables for CSS', () => {
    expect(toneCss('violet')).toBe('var(--color-violet)');
    expect(toneCss(['canvas', 'violet', 0.25])).toBe(
      'color-mix(in srgb, var(--color-canvas) 75%, var(--color-violet))',
    );
  });
});
