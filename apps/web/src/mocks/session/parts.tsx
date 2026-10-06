import {
  Ellipsis,
  FileText,
  PanelRight,
  Play,
  RotateCcw,
  SquareTerminal,
  TextAlignStart,
  Undo2,
  User,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';

import { Button, Chip, Kbd, roomTransition } from '../../ui';
import { DEFAULT_VISUAL, VISUAL_NAMES, VisualSwatch } from '../../visuals';
import { Brand, Spinner } from '../mode/shared';
import { CONTEXT_LABEL, CONTINUE_MESSAGE, SAMPLE, type SessionState } from './model';

const icon = { size: 16, strokeWidth: 1.8, 'aria-hidden': true } as const;

/** Today's top bar, plus Reset. Back, Visual, Show and Worker are look-alikes; Transcript and Reset work. */
export function MockTopBar({
  state,
  transcriptOpen,
  onTranscript,
  onReset,
}: {
  readonly state: SessionState;
  readonly transcriptOpen: boolean;
  readonly onTranscript: () => void;
  readonly onReset: () => void;
}) {
  const resetting = state === 'resetting';
  const reset = (
    <Button
      tone="ghost"
      aria-label="Reset: end this session and go back to the start"
      unavailable={resetting}
      className={`text-sm ${state === 'resetFailed' ? 'text-red hover:text-red' : ''}`}
      icon={resetting ? <Spinner size={15} /> : <RotateCcw {...icon} />}
      onClick={onReset}
    >
      <span className="max-sm:hidden">{resetting ? 'Resetting…' : 'Reset'}</span>
    </Button>
  );
  const divider = <span aria-hidden className="mx-1 h-5 w-px bg-line/45 max-sm:mx-0.5" />;
  return (
    <header className="relative z-20 flex min-h-17 items-center gap-3 px-4.5 py-3.5 max-sm:gap-1 max-sm:px-3">
      <Brand />
      <div className="ml-auto flex items-center gap-1.5 max-sm:gap-0.5">
        <Button
          tone="ghost"
          aria-label="Back"
          unavailable
          className="text-sm"
          icon={<Undo2 {...icon} />}
        >
          <span className="max-sm:hidden">Back</span>
          <span className="max-sm:hidden">
            <Kbd>B</Kbd>
          </span>
        </Button>
        <Button tone="ghost" aria-label="Visual" className="text-sm">
          <VisualSwatch id={DEFAULT_VISUAL} />
          <span className="max-sm:hidden">{VISUAL_NAMES[DEFAULT_VISUAL]}</span>
        </Button>
        <Button
          tone="ghost"
          aria-label="Show"
          unavailable
          className="text-sm"
          icon={<PanelRight {...icon} />}
        >
          <span className="max-sm:hidden">Show</span>
          <span className="max-sm:hidden">
            <Kbd>S</Kbd>
          </span>
        </Button>
        <Button
          tone="ghost"
          aria-label="Transcript"
          aria-pressed={transcriptOpen}
          className="text-sm"
          icon={<TextAlignStart {...icon} />}
          onClick={onTranscript}
        >
          <span className="max-sm:hidden">Transcript</span>
          <span className="max-sm:hidden">
            <Kbd>E</Kbd>
          </span>
        </Button>
        <Button
          tone="ghost"
          aria-label="Worker"
          className="text-sm"
          icon={<SquareTerminal {...icon} />}
        >
          <span className="max-sm:hidden">Worker</span>
          <span className="max-sm:hidden">
            <Kbd>W</Kbd>
          </span>
        </Button>
        {divider}
        {reset}
      </div>
    </header>
  );
}

/** Today's Tap to resume surface with the Tap to start label. */
export function TapToStart({
  visible,
  unavailable,
  onStart,
}: {
  readonly visible: boolean;
  readonly unavailable: boolean;
  readonly onStart: () => void;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          aria-disabled={unavailable || undefined}
          onClick={unavailable ? undefined : onStart}
          className="absolute top-1/2 left-1/2 z-10 inline-flex min-h-11 -translate-1/2 cursor-pointer items-center gap-2.5 rounded-xl border border-fg/16 bg-scrim/42 py-2.5 pr-4.5 pl-3.5 text-[15px] font-semibold whitespace-nowrap text-fg shadow-soft backdrop-blur-md backdrop-saturate-140 hover:bg-scrim/58 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-blue aria-disabled:cursor-default aria-disabled:opacity-50"
          initial={{ opacity: 0, scale: 0.96, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.96, filter: 'blur(4px)' }}
          transition={roomTransition}
        >
          <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden />
          Tap to start
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/** The status line's look, with this story's copy. */
export function MockStatus({
  state,
  elapsed,
}: {
  readonly state: SessionState;
  readonly elapsed: number;
}) {
  const line: Record<SessionState, { text: string; color: string; pulse: boolean; error?: true }> =
    {
      ready: { text: 'Ready when you are.', color: 'var(--color-cyan)', pulse: false },
      starting: {
        text: `Thinking · 0:0${Math.min(elapsed, 9)}`,
        color: 'var(--color-violet)',
        pulse: true,
      },
      speaking: { text: '', color: 'var(--color-blue)', pulse: false },
      resetting: { text: 'Ending this session…', color: 'var(--color-fg-subtle)', pulse: true },
      resetFailed: {
        text: 'Couldn’t reset: the backend didn’t answer. Press Reset to try again.',
        color: 'var(--color-red)',
        pulse: false,
        error: true,
      },
    };
  const { text, color, pulse, error } = line[state];
  return (
    <div
      role="status"
      className="flex min-h-[18px] items-center justify-center gap-2.5 font-mono text-xs tracking-[0.04em] text-fg-subtle"
    >
      <i
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${pulse ? 'motion-safe:animate-breathe' : ''} ${text ? '' : 'opacity-0'}`}
        style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
      />
      <span
        key={text}
        className={`motion-safe:animate-[status-in_var(--duration-ui)_var(--ease-expo)] ${error ? 'text-red' : ''}`}
      >
        {text}
      </span>
    </div>
  );
}

/** The transcript layer with this story's rows. Markup mirrors `conversation/Transcript.tsx`. */
export function MockTranscript({ state }: { readonly state: SessionState }) {
  const started = state === 'starting' || state === 'speaking';
  return (
    <div className="absolute inset-0 overflow-y-auto px-4 pt-2 pb-6 [mask-image:linear-gradient(transparent,#000_28px)]">
      <ol aria-label="Transcript" className="mx-auto max-w-220">
        {started ? (
          <>
            <Row node={<YouNode />} first last={false}>
              <Head type="user_message">
                <span className="font-semibold text-fg">You</span>
              </Head>
              <p className="mt-0.5 rounded-[6px_16px_16px_16px] border border-line/35 bg-elevated/70 px-3.5 py-2.5 text-fg">
                {CONTINUE_MESSAGE}
              </p>
            </Row>
            {state === 'starting' ? (
              <Row node={<PendingNode />} first={false} last pending>
                <Head>
                  <span className="text-fg-muted">Thinking</span>
                </Head>
              </Row>
            ) : (
              <Row node={<SpeakerNode />} first={false} last current>
                <Head type="speak">
                  <span className="font-semibold text-fg">{SAMPLE.speaker}</span>
                  <span className="font-mono text-[11.5px] tracking-[0.03em] text-fg-subtle">
                    host
                  </span>
                </Head>
                <p className="pt-0.5 text-[17px] leading-normal text-fg">
                  {SAMPLE.firstLine}{' '}
                  <Chip tone="blue" live>
                    Now playing
                  </Chip>
                </p>
              </Row>
            )}
          </>
        ) : (
          <Row node={<YouNode waiting />} first last>
            <Head type="preloaded start">
              <span className="font-semibold text-fg">You</span>
              <Chip tone="violet">Preloaded</Chip>
            </Head>
            <p className="mt-0.5 rounded-[6px_16px_16px_16px] border border-dashed border-violet/40 bg-elevated/35 px-3.5 py-2.5 text-fg-muted">
              {CONTINUE_MESSAGE}
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-[13px] text-fg-subtle">
              <FileText size={13} strokeWidth={1.8} aria-hidden />
              Sent with context: {CONTEXT_LABEL.toLowerCase()}
            </p>
            <p className="mt-2 text-[13px] text-fg-subtle">Sent when you tap to start.</p>
          </Row>
        )}
      </ol>
    </div>
  );
}

function Row({
  node,
  first,
  last,
  pending = false,
  current = false,
  children,
}: {
  readonly node: ReactNode;
  readonly first: boolean;
  readonly last: boolean;
  readonly pending?: boolean;
  readonly current?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <li
      data-current={current}
      style={{ '--sc': 'var(--color-blue)' } as React.CSSProperties}
      className="relative grid grid-cols-[30px_minmax(0,1fr)] gap-x-3.5 pb-3"
    >
      <span
        aria-hidden
        className={`absolute left-[14.5px] w-px ${first ? 'top-[15px]' : 'top-0'} ${last ? 'h-[15px]' : 'bottom-0'} ${pending ? 'border-l border-dashed border-violet/50' : 'bg-line/40'}`}
      />
      {node}
      <div className="min-w-0">{children}</div>
    </li>
  );
}

function Head({ type, children }: { readonly type?: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-[30px] flex-wrap items-center gap-2 text-sm">
      {children}
      {type && (
        <span className="ml-auto font-mono text-[11px] text-fg-subtle/75 max-sm:hidden">
          {type}
        </span>
      )}
    </div>
  );
}

const nodeBase =
  'relative z-10 grid size-[30px] place-items-center rounded-full font-display text-xs font-semibold';

function YouNode({ waiting = false }: { readonly waiting?: boolean }) {
  return (
    <span
      aria-hidden
      className={`${nodeBase} bg-elevated text-fg-muted ${waiting ? 'shadow-[0_0_0_1px_rgb(198_160_246/0.45)] [outline:1px_dashed_rgb(198_160_246/0.35)] outline-offset-2' : 'shadow-[0_0_0_1px_rgb(91_96_120/0.6)]'}`}
    >
      <User size={14} strokeWidth={1.8} />
    </span>
  );
}

function PendingNode() {
  return (
    <span
      aria-hidden
      className={`${nodeBase} bg-violet/12 text-violet shadow-[0_0_0_1px_rgb(198_160_246/0.4)] motion-safe:animate-breathe`}
    >
      <Ellipsis size={14} strokeWidth={1.8} />
    </span>
  );
}

function SpeakerNode() {
  return (
    <span
      aria-hidden
      className={`${nodeBase} bg-[color-mix(in_srgb,var(--sc)_18%,var(--color-canvas))] text-(--sc) shadow-[0_0_0_1px_var(--sc),0_0_14px_color-mix(in_srgb,var(--sc)_60%,transparent)]`}
    >
      {SAMPLE.speaker[0]}
    </span>
  );
}
