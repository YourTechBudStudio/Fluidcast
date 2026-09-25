/** What a visual shows. Derived from the conversation phase, connection and playback by the caller. */
export type VisualState = 'idle' | 'thinking' | 'speaking' | 'error' | 'offline';

/** Number of log-spaced spectrum bins, 80 Hz to 8 kHz. */
export const BIN_COUNT = 48;

/**
 * Per-frame audio analysis. Visuals read it inside their own animation loop; it never goes through atoms.
 * Each visual runs its own followers on `raw × its state's gain`, as its mock did, so the shape of a fade belongs to the visual.
 */
export interface Analysis {
  /** Instantaneous 0..1 level from the source, before any smoothing. */
  readonly raw: number;
  /** Smoothed 0..1 spectrum: neighbour blur, then a critically damped spring per bin (6 rad/s up, 2.8 rad/s down). */
  readonly spectrum: Float32Array;
  /** Advances the spectrum to `now` (a `requestAnimationFrame` timestamp). Idempotent within a frame. */
  update(now: number): void;
}

/**
 * Where raw audio comes from. Phase 2 uses a synthetic voice; the real player supplies an analyser over the playing clip.
 * `sample` writes raw 0..1 bins into `out` (zeros for silence) and returns the raw 0..1 level.
 */
export interface AnalysisSource {
  sample(now: number, out: Float32Array): number;
}

/** Everything a visual needs. */
export interface VisualInputs {
  readonly state: VisualState;
  readonly analysis: Analysis;
  readonly reducedMotion: boolean;
  /** Playback is held (autoplay blocked, waiting for "Tap to resume"): the visual dims and stops reacting. */
  readonly held: boolean;
}
