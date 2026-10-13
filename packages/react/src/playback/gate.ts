import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { Effect, type Stream } from 'effect';
import { Atom, AtomRegistry } from 'effect/reactivity';
import { useMemo } from 'react';

// The atoms are module-private: only the writers below change them, synchronously, from React event handlers and the
// presence effect. No runtime-backed command, Effect, fiber or stream writes them, so delayed runtime work can never
// undo a newer visibility or revocation.

/** The host shows this instance and it is mounted. Set by the instance root's presence effect. */
const presentAtom = Atom.make(true).pipe(Atom.keepAlive);
/** The listener has asked this instance to present. Set by presenting intents, cleared by hiding. */
const authorizedAtom = Atom.make(false).pipe(Atom.keepAlive);

/** Synchronous gate writes, for React event handlers and the presence effect only. */
export interface PlaybackGateWriters {
  /** The listener asked this instance to present. */
  readonly authorize: () => void;
  /** Shown and mounted. Never touches authorization. */
  readonly appear: () => void;
  /**
   * Not shown, or unmounting. `revoke` also forgets authorization (hiding); unmounting keeps it, as the instance is
   * going away.
   */
  readonly disappear: (options: { readonly revoke: boolean }) => void;
}

/** This instance's gate writers, with stable identities. */
export function usePlaybackGate(): PlaybackGateWriters {
  const setPresent = useAtomSet(presentAtom);
  const setAuthorized = useAtomSet(authorizedAtom);
  return useMemo(
    () => ({
      authorize: () => setAuthorized(true),
      appear: () => setPresent(true),
      disappear: ({ revoke }) => {
        setPresent(false);
        if (revoke) setAuthorized(false);
      },
    }),
    [setPresent, setAuthorized],
  );
}

/** Whether the host shows this instance now. */
export function usePresent(): boolean {
  return useAtomValue(presentAtom);
}

/** What the instance allows beyond the session's own pause. Read-only. */
export interface PlaybackGate {
  /**
   * Authorized and present, read at the moment of the call: the latest synchronous gate writes, even before `present`
   * has delivered them. Read before a clip starts and before any completion is reported.
   */
  readonly open: Effect.Effect<boolean>;
  /** The current presence, then each change. It holds the element back while the instance is not shown. */
  readonly present: Stream.Stream<boolean>;
}

/** The gate of the instance whose registry this is. */
export const gateOf = (registry: AtomRegistry.AtomRegistry): PlaybackGate => ({
  open: Effect.sync(() => registry.get(authorizedAtom) && registry.get(presentAtom)),
  present: AtomRegistry.toStream(registry, presentAtom),
});
