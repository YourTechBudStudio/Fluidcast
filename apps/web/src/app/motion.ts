/**
 * The mode screen's motion constants: one easing curve and one duration ladder, never an overshoot. Mirrors the
 * `--ease-expo` and `--duration-*` tokens in `styles.css`.
 */
export const EASE_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Seconds, for `motion`. */
export const DURATION = {
  micro: 0.11,
  ui: 0.19,
  surface: 0.32,
  room: 0.6,
} as const;
