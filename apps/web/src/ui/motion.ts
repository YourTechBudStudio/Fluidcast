import type { Transition } from 'motion/react';

/**
 * One easing curve and one duration ladder for the whole player: fast start, soft landing, never an overshoot.
 * Mirrors the `--ease-expo` and `--duration-*` tokens in `styles.css`.
 */
export const EASE_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Seconds, for `motion`. */
export const DURATION = {
  micro: 0.11,
  ui: 0.19,
  surface: 0.32,
  room: 0.6,
} as const;

export const uiTransition: Transition = { duration: DURATION.ui, ease: EASE_EXPO };
export const surfaceTransition: Transition = { duration: DURATION.surface, ease: EASE_EXPO };
export const roomTransition: Transition = { duration: DURATION.room, ease: EASE_EXPO };

/** Expo-out as a function of normalised time, for per-frame interpolation outside `motion`. */
export const easeOutExpo = (x: number): number => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
