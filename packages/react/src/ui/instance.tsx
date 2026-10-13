import { createContext, useContext } from 'react';

/** The class on every player instance's root element: the stylesheet scopes every rule to it. */
export const ROOT_CLASS = 'fluidcast-player';

/** One mounted player, as its descendants see it. */
export interface PlayerInstance {
  /** The instance root: portals render into it. */
  readonly root: HTMLDivElement;
}

export const PlayerInstanceContext = createContext<PlayerInstance | null>(null);

/** The player instance this component renders in. Throws outside a player: every consumer is inside one. */
export function usePlayerInstance(): PlayerInstance {
  const instance = useContext(PlayerInstanceContext);
  if (instance === null) throw new Error('usePlayerInstance: rendered outside a FluidcastPlayer');
  return instance;
}
