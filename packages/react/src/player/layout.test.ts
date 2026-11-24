import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  COMPACT_BELOW_PX,
  layoutFor,
  NARROW_BELOW_PX,
  SHOW_PANEL_MIN_PX,
  SHOW_PANEL_SHARE,
} from './layout';

describe('layoutFor', () => {
  it('is compact below 640 px', () => {
    expect(layoutFor(639).compact).toBe(true);
    expect(layoutFor(640).compact).toBe(false);
  });

  it('shows the full-width sheet below 1024 px and the panel from there', () => {
    expect(layoutFor(639).show).toBe('sheet');
    expect(layoutFor(800).show).toBe('sheet');
    expect(layoutFor(1023).show).toBe('sheet');
    expect(layoutFor(1024).show).toBe('panel');
    expect(layoutFor(1440).show).toBe('panel');
  });

  it('fits the panel at its minimum from the narrowest width that shows it', () => {
    expect(SHOW_PANEL_SHARE * NARROW_BELOW_PX).toBeGreaterThanOrEqual(SHOW_PANEL_MIN_PX);
  });
});

describe('the CSS width variants', () => {
  const css = readFileSync(new URL('../styles/player.css', import.meta.url), 'utf8');
  const below = (variant: string) =>
    Number(
      new RegExp(
        String.raw`@custom-variant ${variant}\s*\{\s*@container fluidcast-player \(width < (\d+)px\)`,
      ).exec(css)?.[1],
    );

  it('mirror the layout tiers', () => {
    expect(below('compact')).toBe(COMPACT_BELOW_PX);
    expect(below('narrow')).toBe(NARROW_BELOW_PX);
  });
});
