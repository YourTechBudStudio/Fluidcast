import { describe, expect, it } from 'vitest';

import {
  between,
  centreOf,
  centredOn,
  clampView,
  fitScale,
  fitView,
  intrinsicSizeOf,
  MAX_SCALE,
  overflows,
  PAD,
  visibleRegion,
  zoomAt,
} from './view';

const wide = { width: 3000, height: 400 };
const small = { width: 200, height: 100 };
const box = { width: 632, height: 432 };

describe('fitView', () => {
  it('fits a large diagram inside the padding and centres it', () => {
    const view = fitView(wide, box);
    expect(view.scale).toBeCloseTo(0.2);
    expect(view.x).toBeCloseTo(PAD);
    expect(view.y).toBeCloseTo((box.height - 400 * 0.2) / 2);
    expect(overflows(view, wide, box)).toBe(false);
  });

  it('never enlarges a small diagram past its own size', () => {
    const view = fitView(small, box);
    expect(view).toEqual({ scale: 1, x: 216, y: 166 });
  });
});

describe('zoomAt', () => {
  it('keeps the diagram point under the pointer in place', () => {
    const start = fitView(wide, box);
    const at = { x: 300, y: 216 };
    const before = (at.x - start.x) / start.scale;
    const zoomed = zoomAt(start, 2, at, wide, box);
    expect(zoomed.scale).toBeCloseTo(0.4);
    expect((at.x - zoomed.x) / zoomed.scale).toBeCloseTo(before);
  });

  it('stops at Fit all and at the maximum', () => {
    const start = fitView(wide, box);
    expect(zoomAt(start, 0.5, { x: 0, y: 0 }, wide, box).scale).toBeCloseTo(fitScale(wide, box));
    expect(zoomAt(start, 1000, { x: 0, y: 0 }, wide, box).scale).toBe(MAX_SCALE);
  });
});

describe('clampView', () => {
  it('stops an overflowing axis at the padding and centres an axis that fits', () => {
    const view = clampView({ scale: 1, x: 500, y: 900 }, wide, box);
    expect(view.x).toBe(PAD);
    expect(view.y).toBe(16);
    expect(clampView({ scale: 1, x: -99999, y: 0 }, wide, box).x).toBe(box.width - PAD - 3000);
  });
});

describe('centredOn and centreOf', () => {
  it('round-trip a diagram point at the viewport centre', () => {
    const view = centredOn({ x: 1500, y: 200 }, 1, wide, box);
    expect(centreOf(view, box)).toEqual({ x: 1500, y: 200 });
  });
});

describe('visibleRegion', () => {
  it('is the part of the diagram on screen, cut to the diagram', () => {
    expect(visibleRegion({ scale: 1, x: -1000, y: PAD }, wide, box)).toEqual({
      x: 1000,
      y: 0,
      width: 632,
      height: 400,
    });
  });
});

describe('between', () => {
  const from = { scale: 1, x: 0, y: 0 };
  const to = { scale: 4, x: -300, y: -150 };

  it('starts at from, ends at to, and moves scale geometrically', () => {
    expect(between(from, to, 0)).toEqual(from);
    expect(between(from, to, 1)).toEqual(to);
    expect(between(from, to, 0.5).scale).toBeCloseTo(2);
  });

  it('holds the anchor over its diagram point when both views agree on it', () => {
    const anchor = { x: 100, y: 50 };
    const zoomed = { scale: 4, x: anchor.x - 100 * 4, y: anchor.y - 50 * 4 };
    const mid = between(from, zoomed, 0.3, anchor);
    expect((anchor.x - mid.x) / mid.scale).toBeCloseTo(100);
    expect(between(from, zoomed, 1, anchor)).toEqual(zoomed);
  });
});

describe('intrinsicSizeOf', () => {
  it("reads the size from Mermaid's viewBox", () => {
    expect(
      intrinsicSizeOf(
        '<svg id="a" width="100%" viewBox="-8 -8 1234.5 678" style="max-width: 1234.5px;">',
      ),
    ).toEqual({ width: 1234.5, height: 678 });
  });

  it('falls back to a usable size without one', () => {
    expect(intrinsicSizeOf('<svg id="a"></svg>')).toEqual({ width: 400, height: 300 });
  });
});
