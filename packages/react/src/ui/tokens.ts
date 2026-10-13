/**
 * Palette values mirrored from the `@theme` block in `styles.css`, for code that cannot read a Tailwind class:
 * WebGL uniforms and inline SVG. `styles.css` stays the source of truth; change both together.
 */
export const palette = {
  canvas: '#24273a',
  subtle: '#2e3244',
  elevated: '#363a4f',
  overlay: '#3a3f57',
  line: '#5b6078',
  scrim: '#141622',
  fg: '#cad3f5',
  'fg-muted': '#a5adcb',
  'fg-subtle': '#6e738d',
  blue: '#8aadf4',
  violet: '#c6a0f6',
  amber: '#f5a97f',
  green: '#a6da95',
  red: '#ed8796',
  cyan: '#91d7e3',
} as const;

export type PaletteName = keyof typeof palette;

export type Rgb = readonly [number, number, number];

/** A palette colour as linear 0..1 channels, the shape the shaders take. */
export const rgb = (name: PaletteName): Rgb => {
  const hex = palette[name].slice(1);
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;
};
