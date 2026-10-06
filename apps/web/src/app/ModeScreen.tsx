import { useAtom, useAtomValue } from '@effect/atom-react';
import { Option } from 'effect';
import { AsyncResult, Atom } from 'effect/unstable/reactivity';
import { ArrowRight, History, Sparkles } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { startSessionAtom } from '../client';
import { Swap, useReducedMotion } from '../ui';
import { createAnalysis, Visual } from '../visuals';
import { Brand } from './Brand';
import { ErrorLine, Spinner } from './feedback';
import { startFailureCopy } from './startFailure';
import { visualAtom } from './state';

/** Where to find a session ID. Claude Code's `/status` does not show it (checked against its command reference). */
const ID_HINT = 'Copy it from a previous session’s Worker view.';

/**
 * The mode screen, shown while no session is live. One gesture covers both modes: the button starts a new brainstorm
 * while the field is empty, and continues the pasted Claude Code session otherwise. The backend is the one check on
 * the ID; the page leaves this screen only when the status stream reports the new session.
 */
export function ModeScreen() {
  const [result, start] = useAtom(startSessionAtom);
  const visual = useAtomValue(visualAtom);
  const reducedMotion = useReducedMotion();
  // No player here: the visual has its own analysis with no source, so it never reacts to audio.
  const analysis = useMemo(() => createAnalysis(), []);
  const inputId = useId();
  const readoutId = useId();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

  // A start that succeeded stays busy until the status stream takes the page to the new session.
  const busy = result.waiting || AsyncResult.isSuccess(result);
  const sessionId = value.trim();
  const mode = sessionId === '' ? 'new' : 'continue';
  const error = busy ? Option.none() : AsyncResult.error(result);
  const failure = Option.match(error, { onNone: () => null, onSome: startFailureCopy });
  const fieldError = Option.exists(error, (e) => e._tag === 'StartFailed');
  const readout =
    mode === 'new'
      ? focused
        ? ID_HINT
        : 'Leave it empty to start a new brainstorm.'
      : 'Continues this session. The voice walks you through its last answer first.';

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
          {/* The visual sits behind the bar like a glow it rises from. */}
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
              if (busy) return;
              start(mode === 'new' ? { mode: 'new' } : { mode: 'continue', sessionId });
            }}
          >
            <label htmlFor={inputId} className="sr-only">
              Claude Code session ID to continue (optional)
            </label>
            <div
              className={`flex min-h-16 items-center gap-2 rounded-xl bg-subtle/85 py-2 pr-2 pl-5 backdrop-blur-md transition-shadow duration-(--duration-surface) ease-expo max-sm:pl-4 ${
                failure
                  ? 'shadow-[inset_0_0_0_1px_rgb(237_135_150/0.55),var(--shadow-lift)]'
                  : 'shadow-[inset_0_0_0_1px_rgb(91_96_120/0.5),var(--shadow-lift)] focus-within:shadow-[inset_0_0_0_1px_rgb(138_173_244/0.7),0_0_0_5px_rgb(138_173_244/0.1),var(--shadow-lift)]'
              }`}
            >
              <History
                size={17}
                strokeWidth={1.8}
                aria-hidden
                className="shrink-0 text-fg-subtle"
              />
              <input
                id={inputId}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  // A Continue failure is about the ID, so editing it clears the line. A backend failure stays.
                  if (fieldError) start(Atom.Reset);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                readOnly={busy}
                spellCheck={false}
                autoComplete="off"
                placeholder="Paste a session ID to continue, or just start"
                aria-invalid={fieldError || undefined}
                aria-describedby={readoutId}
                className="min-w-0 flex-1 bg-transparent py-2 font-mono text-[14px] text-fg outline-none placeholder:font-sans placeholder:text-[15px] placeholder:text-fg-subtle"
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
    </div>
  );
}
