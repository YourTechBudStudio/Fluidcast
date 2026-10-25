import { useAtomValue } from '@effect/atom-react';
import { Option } from 'effect';
import { useMemo } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { FluidcastPlayer } from '@yourtechbudstudio/fluidcast-react';

import { referenceConnection, sessionStatusAtom } from '../client';
import { WorkerStripMock } from './mock/WorkerStripMock';
import { ModeScreen } from './ModeScreen';
import { ResetControl } from './ResetControl';
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
 * The live session's player. The ID comes from the status, never the URL, so a stale or typed URL never connects.
 */
function SessionScreen() {
  const status = useAtomValue(sessionStatusAtom);
  // The gate renders this route only while the status names this session.
  if (Option.isNone(status) || status.value._tag !== 'Active') return null;
  const id = status.value.id;
  return <PlayerScreen key={id} sessionId={id} />;
}

/** Focuses the player root as it attaches, so its shortcuts (E, W, S, B) work without a first click. Stable on purpose. */
const focusPlayer = (root: HTMLDivElement | null) => root?.focus({ preventScroll: true });

/**
 * One session: the app strip with Reset, then the player over this session's connection. The connection is built once
 * per session; when the session changes or ends, React unmounts the player, which releases its Client, audio and
 * streams without ending the backend session. The player is always shown here: hiding the browser tab does not pause.
 */
function PlayerScreen({ sessionId }: { readonly sessionId: string }) {
  const connection = useMemo(() => referenceConnection(sessionId), [sessionId]);
  return (
    <div className="relative z-10 grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex min-h-[38px] items-center justify-end px-3 pt-1">
        <ResetControl sessionId={sessionId} />
      </div>
      <div className="min-h-0">
        <FluidcastPlayer connection={connection} visible ref={focusPlayer} />
      </div>
    </div>
  );
}

/** `/` is the mode screen and `/session/:sessionId` the player; the status gate keeps the URL in line with the backend. */
const router = createBrowserRouter([
  // Throwaway design mock, outside the status gate so it needs no backend.
  { path: 'mock/worker-strip', element: <WorkerStripMock /> },
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
