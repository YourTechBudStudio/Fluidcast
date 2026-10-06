import { Option } from 'effect';

import type { SessionStatus } from '@fluidcast/app-contract';

/** What the page does with its URL: wait for the first status, move to where the status says, or show the route. */
export type RouteDecision =
  | { readonly _tag: 'Connecting' }
  | { readonly _tag: 'Redirect'; readonly to: string }
  | { readonly _tag: 'Render' };

/** The player's path for a backend session. */
export const sessionPath = (sessionId: string) => `/session/${encodeURIComponent(sessionId)}`;

/**
 * The backend's session status is the only source of truth: `/` is the mode screen while no session is live, and the
 * live session's own path is its player. Any other URL redirects there.
 */
export function routeFor(status: Option.Option<SessionStatus>, pathname: string): RouteDecision {
  if (Option.isNone(status)) return { _tag: 'Connecting' };
  const target = status.value._tag === 'Active' ? sessionPath(status.value.id) : '/';
  return pathname === target ? { _tag: 'Render' } : { _tag: 'Redirect', to: target };
}
