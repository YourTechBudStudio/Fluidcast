import { Menu } from '@base-ui/react/menu';
import { useAtom, useAtomValue } from '@effect/atom-react';
import { Check, ChevronDown, SquareTerminal, X } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef } from 'react';

import type { WorkerStatus, WorkerSummary } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { Button, Chip, Kbd, useReducedMotion } from '../ui';
import { CopySessionId } from './CopySessionId';
import {
  selectedWorker,
  selectedWorkerAtom,
  workerListAtom,
  workerTranscriptAtom,
  type WorkersConnection,
} from './state';
import { WorkerTranscript } from './WorkerTranscript';

const STATUS_COLOR: Record<WorkerStatus, string> = {
  working: 'var(--color-violet)',
  done: 'var(--color-green)',
  failed: 'var(--color-red)',
};

const STATUS_LABEL: Record<WorkerStatus, string> = {
  working: 'Working',
  done: 'Done',
  failed: 'Failed',
};

/** Follow new output only while the reader is this close to the end. */
const FOLLOW_PX = 48;

/**
 * The Workers layer: a header with a worker menu (there is no list screen), the selected worker's status, its
 * session-ID copy button and a close button, then that worker's transcript. Mounted only while the layer shows, so its
 * streams run only then.
 */
export function WorkersLayer({
  latest,
  onClose,
}: {
  /** The worker the last agent call addressed: it carries the "Latest" chip. */
  readonly latest: string | null;
  readonly onClose: () => void;
}) {
  const list = useAtomValue(workerListAtom);
  const [selected, setSelected] = useAtom(selectedWorkerAtom);
  const workers = list.data ?? [];
  const worker = selectedWorker(workers, selected);
  // The latest agent call's worker, else the most recently created one.
  const latestWorker =
    workers.find((w) => w.agent === latest)?.agent ?? workers.at(-1)?.agent ?? null;
  const loading = list.data === undefined;

  return (
    <div className="absolute inset-0 flex flex-col">
      <header className="relative z-10 px-4 max-sm:px-3">
        <div className="mx-auto flex max-w-220 flex-wrap items-center gap-x-1.5 gap-y-0 border-b border-line/25 pb-1">
          <h2 tabIndex={-1} data-layer-heading className="sr-only">
            Workers
          </h2>
          {loading ? (
            <span className="inline-flex min-h-11 items-center px-3 font-mono text-[12px] text-fg-subtle">
              Loading workers…
            </span>
          ) : worker ? (
            <WorkerMenu
              workers={workers}
              latest={latestWorker}
              value={worker}
              onChange={setSelected}
            />
          ) : (
            <span className="inline-flex min-h-11 items-center gap-2 px-3 font-mono text-[11px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
              <SquareTerminal size={14} strokeWidth={1.8} aria-hidden />
              Workers
            </span>
          )}
          {worker && <WorkerState status={worker.status} />}
          <div className="ml-auto flex items-center gap-1">
            {worker && <CopySessionId id={worker.sessionId} />}
            <Button
              tone="ghost"
              aria-label="Close workers"
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
      {loading ? (
        <Scroller connection={list.connection}>
          <Loading />
        </Scroller>
      ) : workers.length === 0 ? (
        <Scroller connection={list.connection}>
          <Empty />
        </Scroller>
      ) : worker === undefined ? (
        <Scroller connection={list.connection}>
          <NotFound onBack={() => setSelected(latestWorker)} />
        </Scroller>
      ) : (
        <WorkerBody
          key={worker.agent}
          worker={worker}
          listConnection={list.connection}
          onBack={() => setSelected(latestWorker)}
        />
      )}
    </div>
  );
}

/** The selected worker's transcript feed. Keyed by worker, so a new selection starts afresh and lands on the end. */
function WorkerBody({
  worker,
  listConnection,
  onBack,
}: {
  readonly worker: WorkerSummary;
  readonly listConnection: WorkersConnection;
  readonly onBack: () => void;
}) {
  const transcript = useAtomValue(workerTranscriptAtom(worker.agent));
  const connection =
    transcript.connection === 'live' && listConnection === 'reconnecting'
      ? 'reconnecting'
      : transcript.connection;
  let body;
  if (transcript.connection === 'notFound') body = <NotFound onBack={onBack} />;
  else if (transcript.data === undefined) body = <Loading />;
  else
    body = (
      <WorkerTranscript
        entries={transcript.data}
        agent={worker.agent}
        agentType={worker.agentType}
        working={worker.status === 'working'}
      />
    );
  return (
    <Scroller connection={connection} follow={transcript.data}>
      {body}
    </Scroller>
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

/** The selected worker's status, without a clock (the status line carries elapsed time). Hidden on phones. */
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

/** Switches workers, newest first. Choosing one returns focus to the trigger (Base UI's behaviour). */
function WorkerMenu({
  workers,
  latest,
  value,
  onChange,
}: {
  readonly workers: ReadonlyArray<WorkerSummary>;
  readonly latest: string | null;
  readonly value: WorkerSummary;
  readonly onChange: (agent: string) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Worker: ${value.agent}. Switch worker`}
        className="-ml-1 inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-3 transition-colors duration-(--duration-ui) ease-expo hover:bg-elevated/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue data-popup-open:bg-elevated/70"
      >
        <StatusDot status={value.status} />
        <span className="font-display text-[15px] font-medium tracking-[-0.01em] text-fg">
          {value.agent}
        </span>
        <span className="font-mono text-[11.5px] text-fg-subtle max-sm:hidden">
          {value.agentType}
        </span>
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden className="text-fg-subtle" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Menu.Popup className="w-72 origin-(--transform-origin) rounded-md border border-line/40 bg-subtle/92 p-1.5 shadow-soft backdrop-blur-xl transition-[opacity,transform] duration-(--duration-ui) ease-expo outline-none data-ending-style:-translate-y-1 data-ending-style:opacity-0 data-starting-style:-translate-y-1 data-starting-style:opacity-0">
            <Menu.Group>
              <Menu.GroupLabel className="px-2.5 pt-2 pb-1.5 font-mono text-[11px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
                Workers
              </Menu.GroupLabel>
              <Menu.RadioGroup value={value.agent} onValueChange={(next: string) => onChange(next)}>
                {workers.toReversed().map((w) => (
                  <Menu.RadioItem
                    key={w.agent}
                    value={w.agent}
                    label={w.agent}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2.5 text-sm text-fg-muted outline-none select-none data-checked:text-fg data-highlighted:bg-overlay/70 data-highlighted:text-fg"
                  >
                    <StatusDot status={w.status} size={6} />
                    <span className="font-medium">{w.agent}</span>
                    <span className="font-mono text-[11px] text-fg-subtle">{w.agentType}</span>
                    {w.agent === latest && <Chip tone="subtle">Latest</Chip>}
                    <span className="ml-auto font-mono text-[11px] text-fg-subtle">
                      {STATUS_LABEL[w.status]}
                    </span>
                    <Menu.RadioItemIndicator className="text-blue">
                      <Check size={15} strokeWidth={1.8} aria-hidden />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-3 pt-[12vh] text-center">
      <span className="grid size-12 place-items-center rounded-full bg-elevated/60 text-fg-subtle shadow-[0_0_0_1px_rgb(91_96_120/0.45)]">
        <SquareTerminal size={20} strokeWidth={1.6} aria-hidden />
      </span>
      <p className="font-display text-[17px] text-fg">No workers yet.</p>
      <p className="max-w-80 text-[15px] text-fg-subtle">
        They appear when the conversation hands work to one.
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

function NotFound({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 pt-[12vh] text-center">
      <p className="font-display text-[17px] text-fg">
        This worker is not in this session any more.
      </p>
      <p className="max-w-96 text-[15px] text-fg-subtle">
        Workers live only for the backend's session. It may have restarted.
      </p>
      <Button tone="quiet" onClick={onBack}>
        Show the latest worker
      </Button>
    </div>
  );
}
