import { useAtomValue } from '@effect/atom-react';
import { SquareTerminal, X } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef } from 'react';

import type { WorkerStatus } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { Button, Kbd, useReducedMotion } from '../ui';
import { CopySessionId, PendingSessionId } from './CopySessionId';
import { workerAtom, workerTranscriptAtom, type WorkersConnection } from './state';
import { WorkerTranscript } from './WorkerTranscript';

const STATUS_COLOR: Record<WorkerStatus, string> = {
  idle: 'var(--color-green)',
  working: 'var(--color-violet)',
  failed: 'var(--color-red)',
};

const STATUS_LABEL: Record<WorkerStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  failed: 'Failed',
};

/** Follow new output only while the reader is this close to the end. */
const FOLLOW_PX = 48;

/**
 * The Worker layer: a header with the worker's status, its session-ID copy button and a close button, then its
 * transcript. A session has exactly one worker. Mounted only while the layer shows, so its streams run only then.
 */
export function WorkersLayer({ onClose }: { readonly onClose: () => void }) {
  const worker = useAtomValue(workerAtom);
  const transcript = useAtomValue(workerTranscriptAtom);
  const summary = worker.data;
  const connection =
    transcript.connection === 'live' && worker.connection === 'reconnecting'
      ? 'reconnecting'
      : transcript.connection;

  return (
    <div className="absolute inset-0 flex flex-col">
      <header className="relative z-10 px-4 max-sm:px-3">
        <div className="mx-auto flex max-w-220 flex-wrap items-center gap-x-1.5 gap-y-0 border-b border-line/25 pb-1">
          <h2
            tabIndex={-1}
            data-layer-heading
            className="-ml-1 inline-flex min-h-11 items-center gap-2.5 px-3 font-display text-[15px] font-medium tracking-[-0.01em] text-fg outline-none"
          >
            {summary ? (
              <StatusDot status={summary.status} />
            ) : (
              <SquareTerminal size={14} strokeWidth={1.8} aria-hidden className="text-fg-subtle" />
            )}
            Worker
          </h2>
          {summary && <WorkerState status={summary.status} />}
          <div className="ml-auto flex items-center gap-1">
            {summary &&
              (summary.sessionId === null ? (
                <PendingSessionId />
              ) : (
                <CopySessionId id={summary.sessionId} />
              ))}
            <Button
              tone="ghost"
              aria-label="Close worker"
              aria-keyshortcuts="W"
              icon={<X size={16} strokeWidth={1.8} aria-hidden />}
              onClick={onClose}
            >
              <span className="max-sm:hidden">
                <Kbd>W</Kbd>
              </span>
            </Button>
          </div>
        </div>
      </header>
      <Scroller connection={connection} follow={transcript.data}>
        {transcript.data === undefined ? (
          <Loading />
        ) : transcript.data.length === 0 ? (
          <Empty />
        ) : (
          <WorkerTranscript entries={transcript.data} working={summary?.status === 'working'} />
        )}
      </Scroller>
    </div>
  );
}

/**
 * The layer's scrolling body. It lands on the end when it mounts and when the connection changes; afterwards new
 * output (`follow`) scrolls it to the end only while the reader is within 48 px of it, so someone who scrolled up to
 * read is left where they are.
 */
function Scroller({
  connection,
  follow,
  children,
}: {
  readonly connection: WorkersConnection;
  readonly follow?: unknown;
  readonly children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
    atEnd.current = true;
  }, [connection]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atEnd.current)
      el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [follow, reduced]);
  return (
    <>
      {connection === 'reconnecting' && (
        <p className="mx-auto flex w-full max-w-220 items-center gap-2 px-7 pt-2 font-mono text-[11.5px] text-fg-subtle max-sm:px-6">
          <i className="size-1.5 rounded-full bg-fg-subtle motion-safe:animate-breathe" />
          Reconnecting… showing what arrived before the connection dropped.
        </p>
      )}
      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_PX;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-8 [mask-image:linear-gradient(transparent,#000_20px)] max-sm:px-3"
      >
        <div className={`mx-auto max-w-220 ${connection === 'reconnecting' ? 'opacity-70' : ''}`}>
          {children}
        </div>
      </div>
    </>
  );
}

function StatusDot({
  status,
  size = 7,
}: {
  readonly status: WorkerStatus;
  readonly size?: number;
}) {
  const color = STATUS_COLOR[status];
  return (
    <i
      aria-hidden
      className={`shrink-0 rounded-full ${status === 'working' ? 'motion-safe:animate-breathe' : ''}`}
      style={{ width: size, height: size, backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
    />
  );
}

/** The worker's status, without a clock (the status line carries elapsed time). Hidden on phones. */
function WorkerState({ status }: { readonly status: WorkerStatus }) {
  const tone =
    status === 'working' ? 'text-violet' : status === 'failed' ? 'text-red' : 'text-fg-subtle';
  return (
    <span
      className={`inline-flex min-h-11 items-center font-mono text-[12px] max-sm:hidden ${tone}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-3 pt-[12vh] text-center">
      <span className="grid size-12 place-items-center rounded-full bg-elevated/60 text-fg-subtle shadow-[0_0_0_1px_rgb(91_96_120/0.45)]">
        <SquareTerminal size={20} strokeWidth={1.6} aria-hidden />
      </span>
      <p className="font-display text-[17px] text-fg">Nothing here yet.</p>
      <p className="max-w-80 text-[15px] text-fg-subtle">
        The worker's transcript appears once the conversation forwards something to it.
      </p>
    </div>
  );
}

function Loading() {
  return (
    <div aria-busy className="flex flex-col gap-3">
      <p className="font-mono text-[12px] text-fg-subtle">Loading transcript…</p>
      {[92, 64, 78, 40, 70].map((width, i) => (
        <span
          key={i}
          className="h-3.5 rounded-full bg-elevated/60 motion-safe:animate-breathe"
          style={{ width: `${width}%`, animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}
