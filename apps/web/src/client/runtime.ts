import { Layer } from 'effect';
import { Atom } from 'effect/reactivity';

import * as FluidcastClient from '@yourtechbudstudio/fluidcast-client';

import { sessionIdAtom } from './session';
import { httpTransport } from './transport';

/**
 * One Client per backend session. Each session has its own atom registry (see `app/Root.tsx`). Disposing it closes
 * this Client's subscription and prefetches. Within a registry it stays alive, because a second Client would supersede
 * the subscription.
 */
export const clientRuntime = Atom.keepAlive(
  Atom.runtime((get) =>
    FluidcastClient.layer().pipe(Layer.provide(httpTransport(get(sessionIdAtom)))),
  ),
);
