import type { AudioUnavailable } from '@yourtechbudstudio/fluidcast-client';

/**
 * The audio element could not play the clip: it failed to load, decode or start. When the clip was `streamed` from
 * its URL, the element also fetched it, so the cause may equally be the network or the backend: the element never
 * reveals the response.
 */
export interface MediaError {
  readonly _tag: 'MediaError';
  readonly streamed: boolean;
}

/** Why a clip failed: its audio could not be obtained, or the browser could not play it. */
export type PlaybackFailure = AudioUnavailable | MediaError;

/**
 * Client-local playback, which never reaches the Harness: whether the clip at the cursor is playing, failed, or held
 * waiting for a gesture because the browser blocked autoplay.
 */
export type PlaybackStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'playing'; readonly actionId: string }
  | { readonly kind: 'failed'; readonly actionId: string; readonly error: PlaybackFailure }
  | { readonly kind: 'held'; readonly actionId: string };

export interface PlaybackControls {
  /** Fetches a fresh clip for the failed line and plays it again. */
  readonly retryClip: () => void;
  /** The user gesture that unblocks autoplay. */
  readonly resume: () => void;
}
