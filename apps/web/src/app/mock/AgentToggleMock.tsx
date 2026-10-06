// TODO(phase-04): MOCK SCAFFOLDING. Delete this file and its dev-only route in `Root.tsx` once its design (agent pills
// inside the bar) is built into `ModeScreen.tsx`. Nothing here talks to the backend: the agent, field and status are fixtures.

import { useAtomValue } from '@effect/atom-react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { SegmentedControl, Swap, useReducedMotion } from '../../ui';
import { createAnalysis, Visual } from '../../visuals';
import { Brand } from '../Brand';
import { ErrorLine, Spinner } from '../feedback';
import { visualAtom } from '../state';

type Agent = 'claude' | 'codex';
type Status = 'idle' | 'busy' | 'failed';

const AGENTS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
] as const;

const AGENT_NAME: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex' };

/** Invented IDs in each agent's shape, for the "pasted" state. */
const SAMPLE_ID: Record<Agent, string> = {
  claude: '0199b7e2-4c1d-7a3e-9f21-5d8c0b6e4a17',
  codex: '019a3f5c-2e8b-7d14-b6a0-93c1e7f24d58',
};

/** The Continue failure each agent shows. Claude's is the existing `SessionNotFound` line in `startFailure.ts`. */
const FAILURE: Record<Agent, string> = {
  claude: 'No Claude Code session with that ID on this machine.',
  codex: 'Couldn’t open this Codex session.',
};

const ID_HINT = 'Copy it from a previous session’s Worker view.';

/**
 * A dev-only mock of the mode screen with the Claude Code / Codex pills inside the bar, at `/mock/agent-toggle`. The
 * pills and the field are live; the start status comes from the fixture panel and the URL, so every state has a link.
 */
export function AgentToggleMock() {
  const [params, setParams] = useSearchParams();
  const status: Status =
    params.get('status') === 'busy'
      ? 'busy'
      : params.get('status') === 'failed'
        ? 'failed'
        : 'idle';
  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const visual = useAtomValue(visualAtom);
  const reducedMotion = useReducedMotion();
  const analysis = useMemo(() => createAnalysis(), []);
  const inputId = useId();
  const readoutId = useId();
  const [agent, setAgent] = useState<Agent>('claude');
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

  const busy = status === 'busy';
  const sessionId = value.trim();
  const mode = sessionId === '' ? 'new' : 'continue';
  // In the real screen only a Continue failure is agent-specific; the fixture shows it whatever the field holds.
  const failure = status === 'failed' ? FAILURE[agent] : null;
  const name = AGENT_NAME[agent];
  const readout =
    mode === 'new'
      ? focused
        ? ID_HINT
        : `Leave it empty to start a new brainstorm with ${name}.`
      : `Continues this ${name} session. The voice walks you through its last answer first.`;

  const inputs = useMemo(
    () => ({
      state: busy ? ('thinking' as const) : ('idle' as const),
      analysis,
      reducedMotion,
      held: false,
    }),
    [busy, analysis, reducedMotion],
  );

  return (
    <div className="relative z-10 grid h-full grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex min-h-17 items-center px-4.5 py-3.5 max-sm:px-3">
        <Brand />
      </header>

      <main className="flex min-h-0 flex-col items-center justify-center px-6 pb-[10vh] max-sm:px-4">
        <div className="relative flex w-full max-w-[680px] flex-col items-center">
          <div className="relative -mb-[clamp(60px,10vh,110px)] h-[clamp(220px,40vh,400px)] w-full max-sm:h-[clamp(170px,30vh,260px)]">
            <Visual id={visual} inputs={inputs} active />
          </div>
          <h1 className="relative mb-6 text-center font-display text-[clamp(24px,3.4vw,34px)] leading-tight font-medium tracking-[-0.025em] text-fg">
            Start talking it through.
          </h1>

          <form
            className="relative w-full"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) setParam('status', 'busy');
            }}
          >
            <label htmlFor={inputId} className="sr-only">
              {name} session ID to continue (optional)
            </label>
            <div
              className={`flex min-h-16 items-center gap-2 rounded-xl bg-subtle/85 py-2 pr-2 pl-2 backdrop-blur-md transition-shadow duration-(--duration-surface) ease-expo ${
                failure
                  ? 'shadow-[inset_0_0_0_1px_rgb(237_135_150/0.55),var(--shadow-lift)]'
                  : 'shadow-[inset_0_0_0_1px_rgb(91_96_120/0.5),var(--shadow-lift)] focus-within:shadow-[inset_0_0_0_1px_rgb(138_173_244/0.7),0_0_0_5px_rgb(138_173_244/0.1),var(--shadow-lift)]'
              }`}
            >
              <SegmentedControl
                label="Agent"
                value={agent}
                options={AGENTS}
                readOnly={busy}
                onChange={(next) => {
                  setAgent(next);
                  // The failure was about the ID under the other agent, so switching clears it, as editing the ID does.
                  if (failure) setParam('status', 'idle');
                }}
              />
              <i aria-hidden className="mx-1 h-6 w-px shrink-0 bg-line/50" />
              <input
                id={inputId}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (failure) setParam('status', 'idle');
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                readOnly={busy}
                spellCheck={false}
                autoComplete="off"
                placeholder="Paste a session ID to continue, or just start"
                aria-invalid={failure ? true : undefined}
                aria-describedby={readoutId}
                className="min-w-0 flex-1 bg-transparent py-2 font-mono text-[14px] text-ellipsis text-fg outline-none placeholder:font-sans placeholder:text-[15px] placeholder:text-fg-subtle"
              />
              <button
                type="submit"
                aria-disabled={busy || undefined}
                className={`inline-flex min-h-12 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-5 text-[15px] font-semibold text-scrim transition-[background-color,box-shadow,opacity] duration-(--duration-surface) ease-expo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue aria-disabled:cursor-default aria-disabled:opacity-45 aria-disabled:shadow-none max-sm:px-3.5 ${
                  mode === 'new'
                    ? 'bg-blue shadow-[0_6px_20px_rgb(138_173_244/0.25)] hover:bg-[#9dbbf6]'
                    : 'bg-violet shadow-[0_6px_20px_rgb(198_160_246/0.25)] hover:bg-[#d2b4f8]'
                }`}
              >
                {busy ? (
                  <Spinner />
                ) : mode === 'new' ? (
                  <Sparkles size={16} strokeWidth={1.8} aria-hidden />
                ) : (
                  <ArrowRight size={16} strokeWidth={2} aria-hidden />
                )}
                <Swap contentKey={busy ? 'busy' : mode}>
                  <span className="max-sm:sr-only">
                    {busy ? 'Starting…' : mode === 'new' ? 'New brainstorm' : 'Continue'}
                  </span>
                </Swap>
              </button>
            </div>
          </form>

          <div className="mt-3 min-h-6 w-full px-5 max-sm:px-4" id={readoutId}>
            {failure ? (
              <ErrorLine text={failure} />
            ) : (
              <p className="text-[13.5px] text-fg-subtle" aria-live="polite">
                {readout}
              </p>
            )}
          </div>
        </div>
      </main>

      <FixturePanel
        status={status}
        onStatus={(s) => setParam('status', s)}
        onPaste={() => {
          setValue(SAMPLE_ID[agent]);
          if (failure) setParam('status', 'idle');
        }}
        onClear={() => setValue('')}
      />
    </div>
  );
}

/** The mock's own controls, kept visually apart from the screen under review. */
function FixturePanel({
  status,
  onStatus,
  onPaste,
  onClear,
}: {
  readonly status: Status;
  readonly onStatus: (status: Status) => void;
  readonly onPaste: () => void;
  readonly onClear: () => void;
}) {
  return (
    <details
      open
      className="fixed right-3 bottom-3 z-20 w-[min(320px,calc(100vw-24px))] rounded-lg border border-dashed border-amber/45 bg-scrim/90 p-3 text-[12.5px] text-fg-muted backdrop-blur-md"
    >
      <summary className="cursor-pointer font-mono text-[11px] tracking-[0.05em] text-amber uppercase">
        Mock fixtures
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <Row label="Status">
          <SegmentedControl
            label="Start status"
            value={status}
            options={[
              { value: 'idle', label: 'Idle' },
              { value: 'busy', label: 'Busy' },
              { value: 'failed', label: 'Failed' },
            ]}
            onChange={onStatus}
          />
        </Row>
        <Row label="Field">
          <div className="flex gap-1.5">
            <FixtureButton onClick={onPaste}>Paste sample ID</FixtureButton>
            <FixtureButton onClick={onClear}>Clear</FixtureButton>
          </div>
        </Row>
      </div>
    </details>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </div>
  );
}

function FixtureButton({
  onClick,
  children,
}: {
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-8 cursor-pointer rounded-md bg-elevated/70 px-2.5 text-fg-muted hover:bg-overlay hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
    >
      {children}
    </button>
  );
}
