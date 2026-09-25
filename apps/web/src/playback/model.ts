/**
 * Client-local playback, which never reaches the Harness: whether the clip at the cursor is playing, failed, or held
 * waiting for a gesture because the browser blocked autoplay.
 */
export type PlaybackStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'playing'; readonly actionId: string }
  | { readonly kind: 'failed'; readonly actionId: string }
  | { readonly kind: 'held'; readonly actionId: string };

export interface PlaybackControls {
  /** Fetches a fresh clip for the failed line and plays it again. */
  readonly retryClip: () => void;
  /** The user gesture that unblocks autoplay. */
  readonly resume: () => void;
}
