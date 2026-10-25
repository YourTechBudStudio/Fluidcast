import { useState } from 'react';

import { formatElapsed, useNow } from '../ui';
import { statusText } from './copy';
import { type ErrorMoment, isErrorMoment, type StatusMoment } from './presentation';

const RED = { color: 'var(--color-red)', pulse: false } as const;

/** Every failure's dot is red; the other moments each have their own. */
const DOT: Record<Exclude<StatusMoment, ErrorMoment>, { color: string; pulse: boolean }> = {
  ready: { color: 'var(--color-cyan)', pulse: false },
  fresh: { color: 'var(--color-cyan)', pulse: false },
  complete: { color: 'var(--color-cyan)', pulse: false },
  interrupted: { color: 'var(--color-cyan)', pulse: false },
  thinking: { color: 'var(--color-violet)', pulse: true },
  waiting: { color: 'var(--color-violet)', pulse: true },
  asking: { color: 'var(--color-cyan)', pulse: false },
  askingText: { color: 'var(--color-cyan)', pulse: false },
  speaking: { color: 'var(--color-blue)', pulse: false },
  held: { color: 'var(--color-fg-subtle)', pulse: false },
  connecting: { color: 'var(--color-fg-subtle)', pulse: true },
  reconnecting: { color: 'var(--color-fg-subtle)', pulse: true },
  superseded: { color: 'var(--color-fg-subtle)', pulse: false },
  paused: { color: 'var(--color-fg-subtle)', pulse: false },
  workerFinished: { color: 'var(--color-cyan)', pulse: false },
  resultsReady: { color: 'var(--color-cyan)', pulse: false },
};

/**
 * One quiet line above the composer, on every layer. It rotates its copy each time the player enters a moment. When a
 * tool halted the conversation, the line leads with what failed. While `paused`, lines the pause holds lead with
 * "Paused". While thinking it counts the elapsed time: from `forwardSince` (when the earliest running worker started),
 * else from when the line entered the moment.
 */
export function StatusLine({
  moment,
  paused = false,
  fault = null,
  forwardSince = null,
}: {
  readonly moment: StatusMoment;
  readonly paused?: boolean;
  readonly fault?: string | null;
  readonly forwardSince?: number | null;
}) {
  // Widget-local rotation: how many times each moment has been entered. Adjusted during render when the moment changes (React's
  // "adjusting state when a prop changes" pattern), so the line never lags the moment by a commit. Computed only from state, so it is
  // idempotent under development mode's double render.
  // `enteredAt` is when the line entered its moment.
  const [rotation, setRotation] = useState(() => ({
    moment,
    index: 0,
    entries: { [moment]: 0 } as Partial<Record<StatusMoment, number>>,
    enteredAt: Date.now(),
  }));
  if (rotation.moment !== moment) {
    const index = (rotation.entries[moment] ?? -1) + 1;
    setRotation({
      moment,
      index,
      entries: { ...rotation.entries, [moment]: index },
      enteredAt: Date.now(),
    });
  }
  const thinking = rotation.moment === 'thinking';
  const now = useNow(thinking);
  const text = statusText(rotation.moment, rotation.index, { paused, fault });

  const error = isErrorMoment(moment);
  const dot = error ? RED : DOT[moment];
  return (
    <div
      role="status"
      className="flex min-h-[18px] items-center justify-center gap-2.5 font-mono text-xs tracking-[0.04em] text-fg-subtle"
    >
      <i
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full transition-[background-color,box-shadow,opacity] duration-(--duration-room) ease-expo ${dot.pulse ? 'motion-safe:animate-breathe' : ''} ${text ? '' : 'opacity-0'}`}
        style={{ backgroundColor: dot.color, boxShadow: `0 0 10px ${dot.color}` }}
      />
      {/* Remounting on each new line fades it in; the previous line simply gives way. */}
      <span
        key={text}
        className={`motion-safe:animate-[fc-status-in_var(--duration-ui)_var(--ease-expo)] ${error ? 'text-red' : ''}`}
      >
        {text}
        {thinking && ` · ${formatElapsed(now - (forwardSince ?? rotation.enteredAt))}`}
      </span>
    </div>
  );
}
