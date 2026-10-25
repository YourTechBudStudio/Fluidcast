import { AnimatePresence, motion } from 'motion/react';

import { DURATION, EASE_EXPO } from '../motion';
import { useReducedMotion } from '../useReducedMotion';
import { formatElapsed, lineOf, type MockEvent, type Simulation, toneOf } from './simulation';

export interface StripProps {
  readonly sim: Simulation;
  readonly now: number;
  readonly onOpen: () => void;
}

/** The label: tool names in the brighter muted tone; "Thinking" with its slow light sweep. */
function Label({ event }: { readonly event: MockEvent }) {
  const { label } = lineOf(event);
  return event.kind === 'thinking' ? (
    <span className="fcm-shimmer shrink-0">{label}</span>
  ) : (
    <span className="shrink-0 text-fg-muted">{label}</span>
  );
}

/** A breathing dot in the activity's colour. */
function Dot({ tone }: { readonly tone: string }) {
  return (
    <i
      aria-hidden
      className="size-1.5 shrink-0 rounded-full transition-[background-color,box-shadow] duration-(--duration-room) motion-safe:animate-breathe"
      style={{ backgroundColor: tone, boxShadow: `0 0 10px ${tone}` }}
    />
  );
}

/**
 * The worker's line, in the status line's slot while the worker works: the latest event on one line, cut with an
 * ellipsis, and the elapsed time. Each event rolls in from below like a split-flap row and the old one rolls away.
 * The whole line is one button that opens the Worker layer.
 */
export function WorkerStrip({ sim, now, onOpen }: StripProps) {
  const reduced = useReducedMotion();
  const current = sim.current;
  if (current === null) return null;
  const { detail } = lineOf(current.event);
  const elapsed = sim.startedAt === null ? '0:00' : formatElapsed(now - sim.startedAt);
  const roll = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 10, filter: 'blur(3px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
        exit: { opacity: 0, y: -10, filter: 'blur(3px)' },
      };
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open the worker"
      className="group relative mx-auto flex min-h-11 w-full max-w-160 cursor-pointer items-center justify-center outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
    >
      <span className="flex min-w-0 items-center gap-2.5 font-mono text-xs tracking-[0.04em] text-fg-subtle transition-colors duration-(--duration-ui) group-hover:text-fg-muted">
        <Dot tone={toneOf(current.event)} />
        <span className="relative h-[18px] min-w-0 overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={current.key}
              {...roll}
              transition={{ duration: DURATION.surface, ease: EASE_EXPO }}
              className="flex h-[18px] min-w-0 items-center gap-2 whitespace-nowrap"
            >
              <Label event={current.event} />
              {detail !== '' && (
                <>
                  <span aria-hidden className="text-fg-subtle/60">
                    ·
                  </span>
                  <span className="min-w-0 truncate">{detail}</span>
                </>
              )}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="shrink-0 tabular-nums text-fg-subtle/80">· {elapsed}</span>
      </span>
    </button>
  );
}
