import { Layer } from 'effect';
import { Atom } from 'effect/unstable/reactivity';

import * as FluidcastClient from '@yourtechbudstudio/fluidcast-client';

import { httpTransport } from './transport';

/**
 * The page's one Client SDK instance over the HTTP transport. Conversation and playback atoms run on it.
 *
 * Kept alive for the page's lifetime: the Harness allows a single subscriber, so a second instance (for
 * example from StrictMode mounting twice, or every consumer briefly unmounting) would open a new
 * subscription and supersede this one.
 */
export const clientRuntime = Atom.keepAlive(
  Atom.runtime(FluidcastClient.layer().pipe(Layer.provide(httpTransport))),
);
