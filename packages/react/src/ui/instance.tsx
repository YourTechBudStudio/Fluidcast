import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';

/** The class on every player instance's root element: the stylesheet scopes every rule to it. */
export const ROOT_CLASS = 'fluidcast-player';

/** One mounted player, as its descendants see it. */
export interface PlayerInstance {
  /** The instance root: portals render into it; shortcuts listen on it. */
  readonly root: HTMLDivElement;
  /** The root's content-box width in CSS px (what the `fluidcast-player` container queries see). */
  readonly width: number;
}

export const PlayerInstanceContext = createContext<PlayerInstance | null>(null);

/** The player instance this component renders in. Throws outside a player: every consumer is inside one. */
export function usePlayerInstance(): PlayerInstance {
  const instance = useContext(PlayerInstanceContext);
  if (instance === null) throw new Error('usePlayerInstance: rendered outside a FluidcastPlayer');
  return instance;
}

/**
 * Subscribes `onKey` to `keydown` on the instance root while `enabled`, so a key reaches only the player that holds
 * focus. The latest `onKey` is always called, so callers need not memoize it.
 */
export function useRootKeydown(onKey: (event: KeyboardEvent) => void, enabled = true): void {
  const { root } = usePlayerInstance();
  const latest = useRef(onKey);
  useLayoutEffect(() => {
    latest.current = onKey;
  });
  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => latest.current(event);
    root.addEventListener('keydown', listener);
    return () => root.removeEventListener('keydown', listener);
  }, [root, enabled]);
}
