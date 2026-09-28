// MOCK ONLY. The Workers layer (program-design §9.3): a header with a worker menu (there is no list screen), the
// session-ID copy button and a close button, then the selected worker's transcript.

import { Menu } from '@base-ui/react/menu';
import { Check, ChevronDown, SquareTerminal, X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';

import { Button, Chip, Kbd, useReducedMotion } from '../../ui';
import type { MockScene, WorkerSummary } from './fixtures';
import { STATUS_LABEL } from './helpers';
import { CopySessionId, StatusDot } from './shared';
import { transcriptTree, turns } from './transcript';
import { WorkerTranscript } from './WorkerTranscript';

export function WorkersLayer({
  scene,
  open,
  selected,
  onSelect,
  onClose,
}: {
  readonly scene: MockScene;
  /** Opening the layer always lands on the latest output. */
  readonly open: boolean;
  readonly selected: string | null;
  readonly onSelect: (agent: string) => void;
  readonly onClose: () => void;
}) {
  const worker = scene.workers.find((w) => w.agent === selected) ?? null;
  const scroller = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const working = worker?.status === 'working';
  const entries = worker ? (scene.transcripts[worker.agent] ?? []) : [];

  // Land on the latest output when the layer opens or the worker changes; afterwards follow new output only while the
  // reader is at the bottom, so someone who scrolled up to read is left alone.
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!open || !el) return;
    el.scrollTo({ top: el.scrollHeight });
    atBottom.current = true;
  }, [open, selected, scene.connection]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current)
      el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [entries, reduced]);

  let body;
  if (scene.connection === 'connecting') body = <Loading />;
  else if (scene.workers.length === 0) body = <Empty />;
  else if (scene.connection === 'notFound' || worker === null)
    body = <NotFound onBack={() => onSelect(scene.latest ?? scene.workers.at(-1)!.agent)} />;
  else
    body = (
      <WorkerTranscript
        turns={turns(transcriptTree(entries, working), working)}
        agent={worker.agent}
        agentType={worker.agentType}
      />
    );

  return (
    <div className="absolute inset-0 flex flex-col">
      <header className="relative z-10 px-4 max-sm:px-3">
        <div className="mx-auto flex max-w-220 flex-wrap items-center gap-x-1.5 gap-y-0 border-b border-line/25 pb-1">
          <h2 tabIndex={-1} data-layer-heading className="sr-only">
            Workers
          </h2>
          {scene.connection === 'connecting' ? (
            <span className="inline-flex min-h-11 items-center px-3 font-mono text-[12px] text-fg-subtle">
              Loading workers…
            </span>
          ) : worker ? (
            <WorkerMenu
              workers={scene.workers}
              latest={scene.latest}
              value={worker}
              onChange={onSelect}
            />
          ) : (
            <span className="inline-flex min-h-11 items-center gap-2 px-3 font-mono text-[11px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
              <SquareTerminal size={14} strokeWidth={1.8} aria-hidden />
              Workers
            </span>
          )}
          {worker && scene.connection !== 'connecting' && <WorkerState worker={worker} />}
          <div className="ml-auto flex items-center gap-1">
            {worker && scene.connection !== 'connecting' && <CopySessionId id={worker.sessionId} />}
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
        {scene.connection === 'reconnecting' && (
          <p className="mx-auto flex max-w-220 items-center gap-2 px-3 pt-2 font-mono text-[11.5px] text-fg-subtle">
            <i className="size-1.5 rounded-full bg-fg-subtle motion-safe:animate-breathe" />
            Reconnecting… showing what arrived before the connection dropped.
          </p>
        )}
      </header>
      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-8 [mask-image:linear-gradient(transparent,#000_20px)] max-sm:px-3"
      >
        <div
          className={`mx-auto max-w-220 ${scene.connection === 'reconnecting' ? 'opacity-70' : ''}`}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

/** The selected worker's status, without a clock (the status line carries elapsed time). Hidden on phones. */
function WorkerState({ worker }: { readonly worker: WorkerSummary }) {
  const tone =
    worker.status === 'working'
      ? 'text-violet'
      : worker.status === 'failed'
        ? 'text-red'
        : 'text-fg-subtle';
  return (
    <span
      className={`inline-flex min-h-11 items-center font-mono max-sm:hidden text-[12px] ${tone}`}
    >
      {STATUS_LABEL[worker.status]}
    </span>
  );
}

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
                {[...workers].reverse().map((w) => (
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
      {[92, 64, 78, 40, 70].map((w, i) => (
        <span
          key={i}
          className="h-3.5 rounded-full bg-elevated/60 motion-safe:animate-breathe"
          style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }}
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
