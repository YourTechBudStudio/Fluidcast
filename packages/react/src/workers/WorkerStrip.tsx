import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

import { DURATION, EASE_EXPO, formatElapsed, useNow, useReducedMotion } from '../ui';
import { activityLine, type WorkerActivity } from './activity';

const ROLL = {
  initial: { opacity: 0, y: 10, filter: 'blur(3px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -10, filter: 'blur(3px)' },
};
const FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };

const rollKey = (activity: WorkerActivity) =>
  activity.kind === 'entry' ? activity.key : `background-${activity.count}`;

/**
 * The worker's line, in the status line's slot while the worker has activity to show: the main agent's latest event
 * on one line, cut with an ellipsis, and the time since the forward started (`since`, else since the strip appeared).
 * Each event rolls in from below like a split-flap row and the old one rolls away; reduced motion crossfades. The whole
 * line is one button that opens the Worker layer. It is not a live region: announcing every tool call would be noise.
 * Its colour is the inherited `--fc-activity`.
 */
export function WorkerStrip({
  activity,
  since,
  onOpen,
}: {
  readonly activity: WorkerActivity;
  readonly since: number | null;
  readonly onOpen: () => void;
}) {
  const reduced = useReducedMotion();
  const [appearedAt] = useState(() => Date.now());
  const now = useNow(true);
  const line = activityLine(activity);
  return (
    // The hit area reaches 44 px while the line keeps the status line's height.
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open the worker"
      aria-keyshortcuts="W"
      className="group mx-auto -my-[13px] flex w-full max-w-160 cursor-pointer items-center justify-center rounded-md py-[13px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
    >
      <span className="flex min-w-0 items-center gap-2.5 font-mono text-xs tracking-[0.04em] text-fg-subtle transition-colors duration-(--duration-ui) ease-expo group-hover:text-fg-muted">
        <i
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-(--fc-activity) shadow-[0_0_10px_var(--fc-activity)] motion-safe:animate-breathe"
        />
        <span className="relative h-[18px] min-w-0 overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={rollKey(activity)}
              {...(reduced ? FADE : ROLL)}
              transition={{ duration: DURATION.surface, ease: EASE_EXPO }}
              className="flex h-[18px] min-w-0 items-center gap-2 whitespace-nowrap"
            >
              <span
                className={`${line.detail === '' ? 'min-w-0 truncate' : 'shrink-0'} ${line.thinking ? 'worker-shimmer' : 'text-fg-muted'}`}
              >
                {line.label}
              </span>
              {line.detail !== '' && (
                <>
                  <span aria-hidden className="text-fg-subtle/60">
                    ·
                  </span>
                  <span className="min-w-0 truncate">{line.detail}</span>
                </>
              )}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="shrink-0 text-fg-subtle/80 tabular-nums">
          · {formatElapsed(now - (since ?? appearedAt))}
        </span>
      </span>
    </button>
  );
}
