import { ChevronDown, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

/** One select in the panel, such as the mock's state. */
export interface MockControl {
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly onChange: (value: string) => void;
}

/**
 * The floating panel on every mock: what the screen decides, its state switcher and the mock's assumptions. Clearly
 * not product UI.
 */
export function MockPanel({
  title,
  summary,
  controls,
  notes,
}: {
  readonly title: string;
  readonly summary: string;
  readonly controls: ReadonlyArray<MockControl>;
  readonly notes: ReadonlyArray<string>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <aside
      aria-label="Mock controls"
      className="fixed right-4 bottom-4 z-50 w-[300px] rounded-lg border border-dashed border-amber/45 bg-scrim/88 text-[13px] text-fg-muted shadow-lift backdrop-blur-md max-sm:right-2 max-sm:bottom-2 max-sm:w-[calc(100%-16px)]"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3.5 text-left focus-visible:outline-2 focus-visible:outline-amber"
      >
        <FlaskConical size={14} strokeWidth={1.8} aria-hidden className="text-amber" />
        <span className="font-mono text-[10.5px] tracking-[0.08em] text-amber uppercase">Mock</span>
        <span className="flex-1 truncate text-fg">{title}</span>
        <ChevronDown
          size={15}
          aria-hidden
          className={`transition-transform duration-(--duration-ui) ease-expo ${open ? '' : 'rotate-180'}`}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line/30 px-3.5 pt-3 pb-3.5">
          <p className="leading-snug text-fg">{summary}</p>
          {controls.map((control) => (
            <label key={control.label} className="flex flex-col gap-1">
              <span className="font-mono text-[10.5px] tracking-[0.08em] uppercase">
                {control.label}
              </span>
              <select
                value={control.value}
                onChange={(e) => control.onChange(e.target.value)}
                className="min-h-9 rounded-sm border border-line/50 bg-subtle px-2 text-fg focus-visible:outline-2 focus-visible:outline-amber"
              >
                {control.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <ul className="list-disc space-y-1 pl-4 text-[12px] leading-snug text-fg-subtle">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <Link
            to="/mocks"
            className="text-[12px] text-amber/90 underline-offset-2 hover:underline"
          >
            All mocks
          </Link>
        </div>
      )}
    </aside>
  );
}
