import { RegistryProvider, useAtomValue } from '@effect/atom-react';
import { Option } from 'effect';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { sessionIdAtom, sessionStatusAtom } from '../client';
import { AgentToggleMock } from './mock/AgentToggleMock';
import { ModeScreen } from './ModeScreen';
import { Player } from './Player';
import { routeFor } from './route';

/**
 * Follows the backend's session status, the only source of truth: it waits for the first status, then moves the URL to
 * where the status says (always replacing it, so Back never returns to a discarded session), then shows the route.
 */
function StatusGate() {
  const status = useAtomValue(sessionStatusAtom);
  const decision = routeFor(status, useLocation().pathname);
  switch (decision._tag) {
    case 'Connecting':
      return (
        <div className="relative z-10 grid h-full place-items-center">
          <p
            role="status"
            className="flex items-center gap-2.5 font-mono text-xs tracking-[0.04em] text-fg-subtle"
          >
            <i
              aria-hidden
              className="size-1.5 rounded-full bg-fg-subtle shadow-[0_0_10px_var(--color-fg-subtle)] motion-safe:animate-breathe"
            />
            Connecting…
          </p>
        </div>
      );
    case 'Redirect':
      return <Navigate to={decision.to} replace />;
    case 'Render':
      return <Outlet />;
  }
}

/**
 * The live session's player, in an atom registry of its own seeded with the session's ID. The ID comes from the
 * status, never the URL, so a stale or typed URL never builds a Client. When the session changes or ends, React
 * unmounts this registry and disposing it closes the session's Client, player and every page-local atom.
 */
function SessionScreen() {
  const status = useAtomValue(sessionStatusAtom);
  // The gate renders this route only while the status names this session.
  if (Option.isNone(status) || status.value._tag !== 'Active') return null;
  const id = status.value.id;
  return (
    <RegistryProvider key={id} initialValues={[[sessionIdAtom, id]]}>
      <Player />
    </RegistryProvider>
  );
}

/** `/` is the mode screen and `/session/:sessionId` the player; the status gate keeps the URL in line with the backend. */
const router = createBrowserRouter([
  // TODO(phase-04): remove with `mock/AgentToggleMock.tsx`. Dev-only, outside the status gate so it needs no backend.
  ...(import.meta.env.DEV ? [{ path: '/mock/agent-toggle', element: <AgentToggleMock /> }] : []),
  {
    element: <StatusGate />,
    children: [
      { index: true, element: <ModeScreen /> },
      { path: 'session/:sessionId', element: <SessionScreen /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function Root() {
  return <RouterProvider router={router} />;
}
