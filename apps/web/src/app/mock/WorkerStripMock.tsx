import {
  ArrowUp,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  SquareTerminal,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

import { DURATION, EASE_EXPO } from '../motion';
import { SegmentedControl } from '../SegmentedControl';
import { BorderGlow } from './borderGlow';
import { lineOf, type Pace, useNow, useSimulation } from './simulation';
import { WorkerStrip } from './WorkerStrip';

import './mock.css';

/** When the worker finishes, the line leaves at once and the border glows green this long, then fades. */
const FINISHED_MS = 1400;

/**
 * Throwaway mock at `/mock/worker-strip`: a stand-in player (orb, subtitle, Show panel, status line, dock) with the
 * worker strip as decided (the Ticker line plus the border glow with a sweep on each event) over a scripted worker
 * turn. No backend; nothing here is the real player.
 */
export function WorkerStripMock() {
  const [pace, setPace] = useState<Pace>('real');
  const [asking, setAsking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);
  const [workerOpen, setWorkerOpen] = useState(false);
  const [showOpen, setShowOpen] = useState(true);
  const sim = useSimulation(pace, paused, run);
  const now = useNow(sim.phase === 'working' || sim.phase === 'done');

  // The forward closes the open Show, a beat after it starts.
  useEffect(() => {
    if (sim.phase !== 'forwarding') return;
    setShowOpen(true);
    const id = window.setTimeout(() => setShowOpen(false), 900);
    return () => window.clearTimeout(id);
  }, [sim.phase, run]);

  // Space pauses, R replays, Q toggles the question.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement) return;
      if (event.key === ' ') {
        event.preventDefault();
        setPaused((p) => !p);
      } else if (event.key === 'r') setRun((r) => r + 1);
      else if (event.key === 'q') setAsking((a) => !a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const finished = sim.phase === 'done' && sim.endedAt !== null && now - sim.endedAt < FINISHED_MS;
  const working = sim.phase === 'working';

  return (
    <div className="relative z-10 grid h-full grid-rows-[auto_minmax(0,1fr)_auto]">
      {/* Mock chrome: not part of the design. */}
      <header className="flex flex-wrap items-center gap-3 border-b border-line/20 bg-scrim/30 px-4 py-2.5">
        <span className="mr-2 font-display text-[14px] font-medium text-fg">
          Worker strip <span className="text-fg-subtle">· mock</span>
        </span>
        <SegmentedControl
          label="Pace"
          value={pace}
          options={[
            { value: 'real', label: 'Real pace' },
            { value: 'brisk', label: 'Brisk' },
          ]}
          onChange={setPace}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <ChromeButton onClick={() => setAsking((a) => !a)} active={asking}>
            Question open <Hint>Q</Hint>
          </ChromeButton>
          <ChromeButton onClick={() => setPaused((p) => !p)} active={paused}>
            {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
            {paused ? 'Resume' : 'Pause'} <Hint>Space</Hint>
          </ChromeButton>
          <ChromeButton onClick={() => setRun((r) => r + 1)}>
            <RotateCcw size={14} aria-hidden /> Replay <Hint>R</Hint>
          </ChromeButton>
        </div>
      </header>
      {/* The stand-in player. */}
      <main className="relative flex min-h-0">
        <div className="relative min-w-0 flex-1">
          <AnimatePresence initial={false}>
            {workerOpen ? (
              <WorkerLog key="worker" sim={sim} onClose={() => setWorkerOpen(false)} />
            ) : (
              <motion.section
                key="stage"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DURATION.surface, ease: EASE_EXPO }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-[clamp(16px,4cqh,40px)] px-6"
              >
                <div className="fcm-orb size-[clamp(140px,26vh,240px)] rounded-full opacity-90" />
                <p className="max-w-150 text-center font-display text-[clamp(17px,2.2vh,21px)] leading-relaxed text-fg">
                  {sim.phase === 'forwarding'
                    ? 'Got it. I’ll hand that to the worker now.'
                    : sim.phase === 'done'
                      ? 'The worker’s back. Want me to walk you through it?'
                      : 'While it works: the strip should feel alive without asking for your attention.'}
                </p>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
        <motion.aside
          aria-label="Show"
          initial={false}
          animate={{ flexBasis: showOpen ? '42%' : '0%', opacity: showOpen ? 1 : 0 }}
          transition={{ duration: DURATION.surface, ease: EASE_EXPO }}
          className="min-w-0 overflow-hidden"
        >
          <div className="h-full min-w-90 py-3 pr-4">
            <div className="flex h-full flex-col gap-3 rounded-[20px] border border-line/35 bg-elevated/40 p-5 shadow-soft backdrop-blur-xl">
              <span className="font-mono text-[11px] tracking-[0.06em] text-fg-subtle uppercase">
                Show · previous reply
              </span>
              <p className="font-display text-[17px] text-fg">Phase 1 recap</p>
              {[86, 72, 90, 54, 66].map((w, i) => (
                <span
                  key={i}
                  className="h-2.5 rounded-full bg-overlay/70"
                  style={{ width: `${w}%` }}
                />
              ))}
              <p className="mt-auto text-[12.5px] text-fg-subtle">
                Closes on forward. Reopen with S in the real player.
              </p>
            </div>
          </div>
        </motion.aside>
      </main>

      <footer className="relative z-20 px-4 pt-3 pb-5">
        {/* The strip takes the status line's slot while the worker works, and gives it back the moment it finishes. */}
        <div className="mb-3 grid min-h-11 grid-cols-[minmax(0,1fr)] items-end justify-items-center [&>*]:col-start-1 [&>*]:row-start-1">
          <AnimatePresence initial={false}>
            {working ? (
              <motion.div
                key="strip"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: DURATION.surface, ease: EASE_EXPO }}
                className="flex w-full justify-center"
              >
                <WorkerStrip sim={sim} now={now} onOpen={() => setWorkerOpen(true)} />
              </motion.div>
            ) : (
              <motion.p
                key="status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DURATION.surface, ease: EASE_EXPO }}
                role="status"
                className="flex min-h-11 items-center gap-2.5 font-mono text-xs tracking-[0.04em] text-fg-subtle"
              >
                <i
                  aria-hidden
                  className="size-1.5 rounded-full bg-cyan shadow-[0_0_10px_var(--color-cyan)]"
                />
                {sim.phase === 'forwarding' ? 'Sending to the worker' : 'Your turn.'}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <MockDock asking={asking} edge={<BorderGlow sim={sim} finished={finished} />} />
      </footer>
    </div>
  );
}

function ChromeButton({
  onClick,
  active = false,
  children,
}: {
  readonly onClick: () => void;
  readonly active?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors duration-(--duration-ui) outline-none focus-visible:outline-2 focus-visible:outline-blue ${active ? 'bg-elevated text-fg shadow-[inset_0_0_0_1px_rgb(91_96_120/0.6)]' : 'text-fg-subtle hover:text-fg-muted'}`}
    >
      {children}
    </button>
  );
}

const Hint = ({ children }: { readonly children: React.ReactNode }) => (
  <kbd className="rounded-md bg-scrim/50 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-subtle">
    {children}
  </kbd>
);

/** The dock, in its composer shape or its question shape; `edge` is the border glow. */
function MockDock({ asking, edge }: { readonly asking: boolean; readonly edge: React.ReactNode }) {
  const icon = { size: 16, strokeWidth: 1.8, 'aria-hidden': true } as const;
  return (
    <motion.div
      initial={false}
      animate={{ maxWidth: asking ? 880 : 680, borderRadius: asking ? 28 : 20 }}
      transition={{ duration: DURATION.room, ease: EASE_EXPO }}
      className={`relative mx-auto w-full border shadow-soft backdrop-blur-xl transition-[border-color,background-color] duration-(--duration-room) ${asking ? 'border-cyan/24 bg-elevated/50' : 'border-line/42 bg-elevated/42'}`}
    >
      {edge}
      {asking && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-12 top-0 h-px bg-linear-to-r from-transparent via-cyan/80 to-transparent"
        />
      )}
      {asking ? (
        <div>
          <div className="px-5 pt-4 pb-3">
            <p className="font-display text-[16px] text-fg">
              Should the strip replace the status line, or sit above it?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {['Replace it', 'Sit above it'].map((choice) => (
                <span
                  key={choice}
                  className="rounded-full border border-line/40 bg-subtle/60 px-3.5 py-2 text-[14px] text-fg-muted"
                >
                  {choice}
                </span>
              ))}
            </div>
          </div>
          <div className="flex justify-center border-t border-line/25 px-2 py-1">
            <Transport />
          </div>
        </div>
      ) : (
        <div className="flex items-end">
          <div className="my-2 ml-1.5 border-r border-line/30 pr-1">
            <Transport />
          </div>
          <textarea
            rows={1}
            placeholder="Say something…"
            className="min-h-14 flex-1 resize-none bg-transparent px-4 py-4 text-[15px] text-fg outline-none placeholder:text-fg-subtle"
          />
          <div className="flex items-center gap-1 p-2">
            <span className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13.5px] text-fg-subtle">
              <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden /> Interrupt
            </span>
            <span className="grid size-10 place-items-center rounded-full bg-blue/20 text-blue/60">
              <ArrowUp {...icon} />
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Transport() {
  const icon = { size: 16, strokeWidth: 1.8, 'aria-hidden': true } as const;
  return (
    <span className="flex items-center text-fg-subtle">
      {[SkipBack, Pause, SkipForward].map((Icon, i) => (
        <span key={i} className="grid size-10 place-items-center">
          <Icon {...icon} />
        </span>
      ))}
    </span>
  );
}

/** A stand-in Worker layer: what clicking the strip opens. */
function WorkerLog({
  sim,
  onClose,
}: {
  readonly sim: ReturnType<typeof useSimulation>;
  readonly onClose: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.surface, ease: EASE_EXPO }}
      className="absolute inset-0 flex flex-col px-4"
    >
      <header className="mx-auto flex w-full max-w-220 items-center gap-2.5 border-b border-line/25 py-1.5">
        <SquareTerminal size={14} strokeWidth={1.8} aria-hidden className="text-violet" />
        <span className="font-display text-[15px] font-medium text-fg">Worker</span>
        <span className="font-mono text-[12px] text-violet">
          {sim.phase === 'working' ? 'Working' : 'Idle'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close worker"
          className="ml-auto grid size-11 cursor-pointer place-items-center rounded-full text-fg-subtle hover:text-fg"
        >
          <X size={16} strokeWidth={1.8} aria-hidden />
        </button>
      </header>
      <ol className="mx-auto w-full max-w-220 flex-1 overflow-y-auto py-4 font-mono text-[12.5px]">
        {sim.history.map((event, i) => {
          const { label, detail } = lineOf(event);
          return (
            <li key={i} className="flex gap-3 py-1.5 text-fg-subtle">
              <span className="w-18 shrink-0 text-fg-muted">{label}</span>
              <span className="min-w-0 break-words">{detail || '…'}</span>
            </li>
          );
        })}
      </ol>
    </motion.section>
  );
}
