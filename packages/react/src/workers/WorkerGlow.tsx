import { useEffect, useState } from 'react';

import type { WorkerStatus, WorkerSummary } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import type { WorkerActivity } from './activity';
import type { WorkersFeed } from './state';
import { TONE_CLASS } from './tone';

/** When the worker stops working, the border glows this long in its finish colour, then fades. */
const FINISH_MS = 1400;

interface Finish {
  readonly tone: 'green' | 'red';
  /** Still glowing; `false` while it fades, which keeps its colour. */
  readonly showing: boolean;
}

/**
 * Light in the dock's own border, for the dock's `edge` slot: everything it paints is masked to the 1 px border ring
 * (plus a faint spill inside), so nothing reaches past the dock.
 * - While there is activity, or a forward is open (`forwardOpen`) before the worker reports anything, the top border
 *   takes the inherited `--fc-activity` colour, a soft glow drifts slowly to and fro, and every new transcript entry
 *   (`pulse`) sends one unhurried sweep along the border. A forward opens only when the cursor reaches its call and
 *   never on a replay, so going back through the conversation never lights it.
 * - When the worker stops working, the border glows green for a moment, or red when it failed, then fades. Only a
 *   change seen while the status feed was live flashes, so connecting to an idle worker does not.
 * Reduced motion keeps the colours and fades, without the drift or the sweep (`workers.css`).
 */
export function WorkerGlow({
  worker,
  activity,
  forwardOpen,
  pulse,
}: {
  readonly worker: WorkersFeed<WorkerSummary>;
  readonly activity: WorkerActivity | null;
  readonly forwardOpen: boolean;
  readonly pulse: number;
}) {
  const live = worker.connection === 'live' ? worker.data?.status : undefined;
  // The last status seen while live, and the finish it caused. Adjusted during render when the live status changes
  // (React's "adjusting state when a prop changes" pattern), so the flash never lags the change by a commit.
  const [seen, setSeen] = useState<WorkerStatus | undefined>(live);
  const [finish, setFinish] = useState<Finish | null>(null);
  if (live !== undefined && live !== seen) {
    setSeen(live);
    if (seen === 'working') setFinish({ tone: live === 'failed' ? 'red' : 'green', showing: true });
    else if (live === 'working') setFinish(null);
  }
  useEffect(() => {
    if (!finish?.showing) return;
    const id = window.setTimeout(() => setFinish({ ...finish, showing: false }), FINISH_MS);
    return () => window.clearTimeout(id);
  }, [finish]);

  const active = finish?.showing !== true && (activity !== null || forwardOpen);
  const on = active || finish?.showing === true;
  return (
    <span
      aria-hidden
      data-worker-glow
      className={`worker-glow ${finish && !active ? TONE_CLASS[finish.tone] : ''} ${on ? 'opacity-100' : 'opacity-0'}`}
    >
      <span className="worker-glow-ring worker-glow-tint" />
      {active && <span className="worker-glow-spill" />}
      {active && <span className="worker-glow-ring worker-glow-drift" />}
      {active && <span key={pulse} className="worker-glow-ring worker-glow-sweep" />}
    </span>
  );
}
