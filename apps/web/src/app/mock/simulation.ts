import { useEffect, useRef, useState } from 'react';

/**
 * Throwaway mock: a scripted worker turn for the activity-strip variants. Nothing here talks to a backend; the events
 * are shaped like the real `TranscriptEntry` kinds (tool calls, text, status) plus the thinking event we plan to add.
 */
export type MockEvent =
  | { readonly kind: 'tool'; readonly name: string; readonly arg: string }
  | { readonly kind: 'thinking'; readonly summary?: string; readonly summaryAfterMs?: number }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'status'; readonly text: string };

interface Step {
  readonly event: MockEvent;
  /** How long the worker stays on this event before the next arrives, at real pace. */
  readonly ms: number;
}

/** One turn: a forward reaches the worker, it reads, thinks for a long stretch, edits, checks and finishes. */
export const SCRIPT: readonly Step[] = [
  { event: { kind: 'thinking' }, ms: 5200 },
  { event: { kind: 'tool', name: 'Read', arg: 'packages/react/src/player/Player.tsx' }, ms: 1500 },
  { event: { kind: 'tool', name: 'Grep', arg: 'thinkingSince' }, ms: 1100 },
  { event: { kind: 'tool', name: 'Read', arg: 'packages/react/src/workers/state.ts' }, ms: 1300 },
  {
    event: {
      kind: 'tool',
      name: 'Bash',
      arg: 'pnpm --filter @yourtechbudstudio/fluidcast-react exec vitest run src/workers/transcript.test.ts --reporter=verbose',
    },
    ms: 3800,
  },
  {
    event: {
      kind: 'thinking',
      summary:
        'Weighing whether the strip should subscribe to the worker feed outside the Worker layer, and what that costs while the layer is closed',
      summaryAfterMs: 3200,
    },
    ms: 13000,
  },
  {
    event: { kind: 'tool', name: 'Agent', arg: 'Explore how Codex emits reasoning items' },
    ms: 3400,
  },
  { event: { kind: 'status', text: 'Found reasoning summaries on item/completed' }, ms: 1600 },
  {
    event: { kind: 'tool', name: 'Edit', arg: 'packages/react/src/conversation/StatusLine.tsx' },
    ms: 1200,
  },
  {
    event: { kind: 'tool', name: 'Edit', arg: 'packages/tool-agent/src/claude/transcript.ts' },
    ms: 1400,
  },
  {
    event: {
      kind: 'text',
      text: 'The strip now reads the worker feed whenever the worker is working, and falls back to a thinking line when nothing has arrived for a while.',
    },
    ms: 2600,
  },
  { event: { kind: 'tool', name: 'Bash', arg: 'pnpm check' }, ms: 5200 },
  { event: { kind: 'thinking' }, ms: 7000 },
];

export type Pace = 'real' | 'brisk';

export type WorkerPhase = 'idle' | 'forwarding' | 'working' | 'done';

export interface Simulation {
  readonly phase: WorkerPhase;
  /** The latest event, with a key that changes on every arrival (including a thinking summary landing). */
  readonly current: { readonly event: MockEvent; readonly key: number } | null;
  readonly history: readonly MockEvent[];
  /** When the worker started, for the elapsed clock. */
  readonly startedAt: number | null;
  readonly endedAt: number | null;
}

const IDLE: Simulation = {
  phase: 'idle',
  current: null,
  history: [],
  startedAt: null,
  endedAt: null,
};

/** Before the worker starts: the voice forwards, and the open Show closes. */
const FORWARD_MS = 1800;
/** After the turn ends: how long the finished state is held before the next run (when looping). */
const REST_MS = 6000;

/**
 * Plays `SCRIPT` on timers. `run` restarts it; `paused` freezes the timeline in place. The thinking summary arrives
 * part-way through its step as a second "event", as a streamed summary would.
 */
export function useSimulation(pace: Pace, paused: boolean, run: number): Simulation {
  const [sim, setSim] = useState<Simulation>(IDLE);
  const scale = pace === 'brisk' ? 0.45 : 1;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let cancelled = false;
    let key = 0;
    const timers = new Set<number>();
    // A timer that waits out pauses: it only counts time while unpaused.
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        let left = ms;
        let last = performance.now();
        const tick = () => {
          const now = performance.now();
          if (!pausedRef.current) left -= now - last;
          last = now;
          if (cancelled) return;
          if (left <= 0) resolve();
          else {
            const id = window.setTimeout(tick, Math.min(left, 100));
            timers.add(id);
          }
        };
        tick();
      });

    const play = async () => {
      setSim({ ...IDLE, phase: 'forwarding' });
      await wait(FORWARD_MS);
      const startedAt = Date.now();
      const history: MockEvent[] = [];
      for (const step of SCRIPT) {
        if (cancelled) return;
        const { event } = step;
        const first: MockEvent =
          event.kind === 'thinking' && event.summaryAfterMs !== undefined
            ? { kind: 'thinking' }
            : event;
        history.push(first);
        setSim({
          phase: 'working',
          current: { event: first, key: ++key },
          history: [...history],
          startedAt,
          endedAt: null,
        });
        if (event.kind === 'thinking' && event.summaryAfterMs !== undefined) {
          await wait(event.summaryAfterMs * scale);
          if (cancelled) return;
          history[history.length - 1] = event;
          setSim({
            phase: 'working',
            current: { event, key: ++key },
            history: [...history],
            startedAt,
            endedAt: null,
          });
          await wait((step.ms - event.summaryAfterMs) * scale);
        } else {
          await wait(step.ms * scale);
        }
      }
      if (cancelled) return;
      setSim((s) => ({ ...s, phase: 'done', endedAt: Date.now() }));
      await wait(REST_MS);
    };
    void play();
    return () => {
      cancelled = true;
      for (const id of timers) window.clearTimeout(id);
    };
  }, [run, scale]);

  return sim;
}

/** `Date.now()`, every 250 ms while `on`. */
export function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** The one line an event becomes: a label (tool name, or what kind of moment) and its detail. */
export const lineOf = (event: MockEvent): { readonly label: string; readonly detail: string } => {
  switch (event.kind) {
    case 'tool':
      return { label: event.name, detail: event.arg };
    case 'thinking':
      return { label: 'Thinking', detail: event.summary ?? '' };
    case 'text':
      return { label: 'Writing', detail: event.text };
    case 'status':
      return { label: 'Status', detail: event.text };
  }
};

/** The activity's colour: thinking violet, reading blue, running cyan, changing peach, writing lavender-grey. */
export const toneOf = (event: MockEvent): string => {
  switch (event.kind) {
    case 'thinking':
      return '#c6a0f6';
    case 'text':
    case 'status':
      return '#a5adcb';
    case 'tool':
      if (['Read', 'Grep', 'Glob', 'WebFetch'].includes(event.name)) return '#8aadf4';
      if (['Edit', 'Write'].includes(event.name)) return '#f5a97f';
      return '#91d7e3';
  }
};
