import type { CSSProperties } from 'react';

import { type Simulation, toneOf } from './simulation';

/**
 * Light in the composer's own border, rendered inside the dock so it takes the dock's radius. Everything it paints is
 * masked to the 1 px border ring (plus a faint spill clipped inside), so nothing reaches past the composer:
 * - while the worker works, the top border takes the activity's colour and a soft glow drifts slowly to and fro;
 * - every new event sends one unhurried sweep along the border;
 * - when the worker finishes (`finished`), the border glows green for a moment, then fades.
 * The colour follows the kind of activity and glides between them.
 */
export function BorderGlow({
  sim,
  finished,
}: {
  readonly sim: Simulation;
  readonly finished: boolean;
}) {
  const working = sim.phase === 'working';
  const event = sim.current?.event;
  const style = {
    opacity: working || finished ? 1 : 0,
    '--fcm-glow': finished ? '#a6da95' : event ? toneOf(event) : '#c6a0f6',
  } as CSSProperties;
  return (
    <span aria-hidden className="fcm-glow" style={style}>
      <span className="fcm-ring fcm-tint" />
      {working && <span className="fcm-drift-spill" />}
      {working && <span className="fcm-ring fcm-drift-ring" />}
      {working && sim.current && <span key={sim.current.key} className="fcm-ring fcm-zap" />}
    </span>
  );
}
