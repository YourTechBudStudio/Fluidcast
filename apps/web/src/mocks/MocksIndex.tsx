import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';

import { MODE_SUMMARY } from './mode/model';
import { SESSION_SUMMARY } from './session/model';

/** The mock gallery: the final mocks for issue #5's UI. */
export function MocksIndex() {
  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <main className="mx-auto max-w-[760px] px-6 py-16 max-sm:px-4 max-sm:py-10">
        <p className="font-mono text-[11px] tracking-[0.12em] text-amber uppercase">
          Throwaway mocks · issue #5
        </p>
        <h1 className="mt-3 font-display text-[36px] font-medium tracking-[-0.03em] text-fg">
          Mode screen, preloaded start, Reset
        </h1>
        <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-fg-muted">
          Presentation only: the final design for each screen. The floating panel switches states.
        </p>

        <section className="mt-12">
          <h2 className="font-display text-[18px] font-medium text-fg">1 · Mode screen</h2>
          <div className="mt-4">
            <MockLink to="/mocks/mode" name="One field" summary={MODE_SUMMARY} />
          </div>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-[18px] font-medium text-fg">
            2 · Session: Tap to start, Preloaded row, Reset
          </h2>
          <div className="mt-4">
            <MockLink to="/mocks/session" name="Preview line" summary={SESSION_SUMMARY} />
          </div>
        </section>
      </main>
    </div>
  );
}

function MockLink({
  to,
  name,
  summary,
}: {
  readonly to: string;
  readonly name: string;
  readonly summary: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-4 rounded-lg bg-subtle/70 p-4 shadow-[inset_0_0_0_1px_rgb(91_96_120/0.4)] transition-colors duration-(--duration-ui) ease-expo hover:bg-elevated/70 focus-visible:outline-2 focus-visible:outline-blue"
    >
      <div className="flex-1">
        <div className="font-medium text-fg">{name}</div>
        <div className="mt-1 text-[14px] text-fg-muted">{summary}</div>
      </div>
      <ArrowUpRight size={16} aria-hidden className="mt-1 text-fg-subtle group-hover:text-fg" />
    </Link>
  );
}
