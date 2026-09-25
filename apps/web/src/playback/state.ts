import { Atom } from 'effect/unstable/reactivity';

import type { PlaybackControls, PlaybackStatus } from './model';

/** Playback of the clip at the cursor. Phase 2 feeds it from fixtures; phase 5 from the real player. */
export const playbackAtom = Atom.make<PlaybackStatus>({ kind: 'idle' }).pipe(Atom.keepAlive);

const unwired = () => console.warn('[playback] no controls are wired');

/** How the UI asks the player to act. The data source installs the implementation. */
export const playbackControlsAtom = Atom.make<PlaybackControls>({
  retryClip: unwired,
  resume: unwired,
}).pipe(Atom.keepAlive);
