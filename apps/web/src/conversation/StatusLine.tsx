import { useEffect, useState } from 'react';

import { formatElapsed, statusText } from './copy';
import type { StatusMoment } from './presentation';

const RED = { color: 'var(--color-red)', pulse: false, error: true } as const;

const DOT: Record<StatusMoment, { color: string; pulse: boolean; error?: true }> = {
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
  generationFailed: RED,
  halted: RED,
  audioMissing: RED,
  voiceFailed: RED,
  audioUnreachable: RED,
  audioUnplayable: RED,
  audioStreamFailed: RED,
  sendUnreachable: RED,
  serverFailed: RED,
  outOfSync: RED,
  connecting: { color: 'var(--color-fg-subtle)', pulse: true },
  reconnecting: { color: 'var(--color-fg-subtle)', pulse: true },
  superseded: { color: 'var(--color-fg-subtle)', pulse: false },
  resetting: { color: 'var(--color-fg-subtle)', pulse: true },
  resetFailed: RED,
  paused: { color: 'var(--color-fg-subtle)', pulse: false },
  workerFinished: { color: 'var(--color-cyan)', pulse: false },
  resultsReady: { color: 'var(--color-cyan)', pulse: false },
};

/** `Date.now()`, re-rendering every second while `on`. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

/**
 * One quiet line above the composer, on every layer. It rotates its copy each time the player enters a moment. When a
 * tool halted the conversation, the line leads with what failed. While `paused`, lines the pause holds lead with
 * "Paused". While thinking it counts the elapsed time: from `thinkingSince` (when the earliest running worker started),
 * else from when the line entered the moment.
 */
export function StatusLine({
  moment,
  paused = false,
  fault = null,
  thinkingSince = null,
}: {
  readonly moment: StatusMoment;
  readonly paused?: boolean;
  readonly fault?: string | null;
  readonly thinkingSince?: number | null;
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

  const dot = DOT[moment];
  const error = dot.error === true;
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
        className={`motion-safe:animate-[status-in_var(--duration-ui)_var(--ease-expo)] ${error ? 'text-red' : ''}`}
      >
        {text}
        {thinking && ` · ${formatElapsed(now - (thinkingSince ?? rotation.enteredAt))}`}
      </span>
    </div>
  );
}
