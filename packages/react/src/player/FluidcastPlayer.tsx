import { RegistryProvider } from '@effect/atom-react';
import { type ReactElement, type Ref, useCallback, useMemo, useState } from 'react';

import { connectionLayerAtom, type PlayerConnection } from '../connection';
import { PlayerInstanceContext, ROOT_CLASS } from '../ui';
import { Player } from './Player';

export interface FluidcastPlayerProps {
  /** One backend session's connection. Identity matters: a different object is a different player instance. */
  readonly connection: PlayerConnection;
  /** The player's root element (focusable, tabIndex -1), for the host to direct keyboard focus. */
  readonly ref?: Ref<HTMLDivElement>;
}

const instanceKeys = new WeakMap<object, number>();
let nextInstanceKey = 0;

/** A stable per-page number for each connection object; React keys must be strings or numbers. */
const instanceKey = (connection: object): number => {
  const known = instanceKeys.get(connection);
  if (known !== undefined) return known;
  const key = ++nextInstanceKey;
  instanceKeys.set(connection, key);
  return key;
};

/**
 * The complete player for one backend session. Each instance has its own atom registry, seeded with the host's
 * connection, so a new connection identity remounts a fresh instance. Unmounting releases the instance; it never
 * destroys the backend session.
 */
export function FluidcastPlayer({ connection, ref }: FluidcastPlayerProps): ReactElement {
  return (
    <RegistryProvider
      key={instanceKey(connection)}
      initialValues={[[connectionLayerAtom, connection]]}
    >
      <PlayerRoot hostRef={ref} />
    </RegistryProvider>
  );
}

/** Hands `element` to the host's ref, returning how to take it back. */
const assignRef = (ref: Ref<HTMLDivElement> | undefined, element: HTMLDivElement) => {
  if (typeof ref === 'function') {
    const cleanup = ref(element);
    return typeof cleanup === 'function' ? cleanup : () => void ref(null);
  }
  if (ref) {
    ref.current = element;
    return () => {
      ref.current = null;
    };
  }
  return () => undefined;
};

/** The instance root: the element the stylesheet scopes to and portals render into. */
function PlayerRoot({ hostRef }: { readonly hostRef: Ref<HTMLDivElement> | undefined }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const attach = useCallback(
    (element: HTMLDivElement) => {
      setRoot(element);
      return assignRef(hostRef, element);
    },
    [hostRef],
  );
  const instance = useMemo(() => (root === null ? null : { root }), [root]);
  return (
    <div ref={attach} className={ROOT_CLASS} tabIndex={-1}>
      {instance !== null && (
        <PlayerInstanceContext value={instance}>
          <Player />
        </PlayerInstanceContext>
      )}
    </div>
  );
}
