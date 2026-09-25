import { FlaskConical } from 'lucide-react';
import { useState } from 'react';

import { SCENARIOS, type ScenarioId } from './driver';

/** Development-only floating panel that jumps to any fixture scenario. */
export function DevPanel({
  current,
  onPick,
}: {
  readonly current: ScenarioId;
  readonly onPick: (id: ScenarioId) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-4 left-4 z-40 flex flex-col-reverse items-start gap-2 max-sm:bottom-auto max-sm:top-16 max-sm:flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mock-scenarios"
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-dashed border-amber/40 bg-scrim/70 px-3 font-mono text-xs text-amber backdrop-blur-md hover:bg-scrim/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
      >
        <FlaskConical size={14} strokeWidth={1.8} aria-hidden />
        mock: {SCENARIOS.find((s) => s.id === current)?.label}
      </button>
      {open && (
        <nav
          id="mock-scenarios"
          aria-label="Mock scenarios"
          className="grid w-56 gap-0.5 rounded-md border border-line/40 bg-subtle/95 p-1.5 shadow-soft backdrop-blur-xl"
        >
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === current}
              onClick={() => onPick(s.id)}
              className="min-h-11 cursor-pointer rounded-sm px-2.5 text-left text-sm text-fg-muted hover:bg-overlay/70 hover:text-fg focus-visible:outline-2 focus-visible:outline-blue aria-current:bg-elevated aria-current:text-fg"
            >
              {s.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
