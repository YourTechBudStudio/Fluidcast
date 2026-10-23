/**
 * The palette for code that cannot use a class or a CSS variable: WebGL uniforms, Mermaid's theme and HTML Show
 * frames. `styles/player.css` is the only source of the values; this reads them as one element resolves them, so it
 * follows whichever theme that element is in. Read it when building what it colours: a theme change reaches CSS at once
 * and these on their next build.
 */
export const PALETTE_NAMES = [
  'canvas',
  'subtle',
  'elevated',
  'overlay',
  'line',
  'scrim',
  'fg',
  'fg-muted',
  'fg-subtle',
  'blue',
  'violet',
  'amber',
  'green',
  'red',
  'cyan',
] as const;

export type PaletteName = (typeof PALETTE_NAMES)[number];

export interface Palette {
  /** The element's `color-scheme`: what a frame or a library with its own dark mode should match. */
  readonly scheme: 'dark' | 'light';
  /** Each colour as `#rrggbb`. */
  readonly hex: Readonly<Record<PaletteName, string>>;
}

/** Stands in for a token the stylesheet did not resolve (it is not loaded, as in DOM tests): visible, never invisible. */
const UNRESOLVED = '#808080';

const HEX = /^#[0-9a-f]{6}$/i;

/** The palette before any element resolved it. Only a misordered caller sees it; it keeps every colour visible. */
export const UNRESOLVED_PALETTE: Palette = {
  scheme: 'dark',
  hex: Object.fromEntries(PALETTE_NAMES.map((name) => [name, UNRESOLVED])) as Record<
    PaletteName,
    string
  >,
};

/** The palette as `element` resolves it. The element must be inside the player root, where the tokens are set. */
export const readPalette = (element: Element): Palette => {
  const style = getComputedStyle(element);
  const hex = Object.fromEntries(
    PALETTE_NAMES.map((name) => {
      const value = style.getPropertyValue(`--color-${name}`).trim();
      return [name, HEX.test(value) ? value.toLowerCase() : UNRESOLVED];
    }),
  ) as Record<PaletteName, string>;
  return { scheme: style.colorScheme.includes('light') ? 'light' : 'dark', hex };
};

export type Rgb = readonly [number, number, number];

/** A `#rrggbb` colour as 0..1 channels, the shape the shaders take. */
export const rgbOf = (hex: string): Rgb =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;

/** A palette colour, or a fixed blend of two: `[a, b, t]` is `a` moved `t` of the way to `b`. */
export type Tone = PaletteName | readonly [PaletteName, PaletteName, number];

/** A tone in `palette`, as shader channels. */
export const toneRgb = (palette: Palette, tone: Tone): Rgb => {
  if (typeof tone === 'string') return rgbOf(palette.hex[tone]);
  const [a, b, t] = tone;
  const from = rgbOf(palette.hex[a]);
  const to = rgbOf(palette.hex[b]);
  return [0, 1, 2].map((i) => from[i]! + (to[i]! - from[i]!) * t) as unknown as Rgb;
};

/** A tone in `palette`, as `#rrggbb`, for libraries that take colour strings. */
export const toneHex = (palette: Palette, tone: Tone): string =>
  `#${toneRgb(palette, tone)
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** A tone as a CSS colour on the theme's variables, so it follows the theme without a rebuild. */
export const toneCss = (tone: Tone): string => {
  if (typeof tone === 'string') return `var(--color-${tone})`;
  const [a, b, t] = tone;
  return `color-mix(in srgb, var(--color-${a}) ${Math.round((1 - t) * 1000) / 10}%, var(--color-${b}))`;
};
