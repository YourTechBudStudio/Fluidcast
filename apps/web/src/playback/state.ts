import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { Effect, Option, Stream, SubscriptionRef } from 'effect';
import { AsyncResult, Atom } from 'effect/reactivity';
import { useMemo } from 'react';

import { clientRuntime } from '../client';
import type { PlaybackControls, PlaybackStatus } from './model';
import { browserMedia, makePlayer } from './player';

/** The page's one player. Kept alive: it owns the audio element and the `AudioContext`. */
const playerAtom = Atom.keepAlive(clientRuntime.atom(Effect.flatMap(browserMedia, makePlayer)));

const statusResultAtom = clientRuntime.atom((get) =>
  Stream.unwrap(
    Effect.map(get.result(playerAtom), (player) => SubscriptionRef.changes(player.status)),
  ),
);

/** Playback of the clip at the cursor, as the player reports it. Client-local: it never reaches the Harness. */
export const playbackAtom = Atom.make((get): PlaybackStatus =>
  get(statusResultAtom).pipe(
    AsyncResult.value,
    Option.getOrElse((): PlaybackStatus => ({ kind: 'idle' })),
  ),
);

const retryClipAtom = clientRuntime.fn((_: void, get) =>
  Effect.flatMap(get.result(playerAtom), (player) => player.retryClip),
);
const resumeAtom = clientRuntime.fn((_: void, get) =>
  Effect.flatMap(get.result(playerAtom), (player) => player.resume),
);

/** How the UI asks the player to act. */
export function usePlaybackControls(): PlaybackControls {
  const retryClip = useAtomSet(retryClipAtom);
  const resume = useAtomSet(resumeAtom);
  return useMemo(
    () => ({ retryClip: () => retryClip(), resume: () => resume() }),
    [retryClip, resume],
  );
}

/** The analyser over what is playing, for the visuals to read each frame. `null` until audio is unlocked. */
export function usePlaybackAnalyser(): () => AnalyserNode | null {
  const player = useAtomValue(playerAtom);
  return useMemo(() => {
    const ready = AsyncResult.value(player);
    return () => (Option.isSome(ready) ? ready.value.analyser() : null);
  }, [player]);
}
