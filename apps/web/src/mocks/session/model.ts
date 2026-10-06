import { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

/**
 * The session page around a Continue start. `ready` is the preloaded start waiting for the tap; `starting` and
 * `speaking` follow the tap; `resetting` and `resetFailed` follow Reset.
 */
export type SessionState = 'ready' | 'starting' | 'speaking' | 'resetting' | 'resetFailed';

export const SESSION_STATES: ReadonlyArray<{ readonly id: SessionState; readonly label: string }> =
  [
    { id: 'ready', label: 'Ready (Tap to start)' },
    { id: 'starting', label: 'After tap: thinking' },
    { id: 'speaking', label: 'After tap: speaking' },
    { id: 'resetting', label: 'Resetting' },
    { id: 'resetFailed', label: 'Reset failed' },
  ];

/** What the final session page decides. */
export const SESSION_SUMMARY =
  'The preloaded message waits in the subtitle slot, so you know what the tap sends before you tap. Reset sits at the right end of the top bar.';

/** Continue's hard-coded first message and its context label, as in program-design.md. */
export const CONTINUE_MESSAGE = 'Walk me through your last answer.';
export const CONTEXT_LABEL = 'Your last answer in this session';

/** Invented for the mock. */
export const SAMPLE = {
  firstLine:
    'Last time we landed on three ways to cache sessions. Let me start with the one I’d pick, the on-disk store.',
  speaker: 'Host',
};

/** The state lives in `?state=` so every state is linkable. */
export function useSessionMock() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const state = (SESSION_STATES.find((s) => s.id === params.get('state'))?.id ??
    'ready') as SessionState;
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const setParam = useCallback(
    (key: string, value: string, fallback: string) =>
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (value === fallback) out.delete(key);
          else out.set(key, value);
          return out;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setState = useCallback((s: SessionState) => setParam('state', s, 'ready'), [setParam]);

  const later = (ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  };

  /** The tap: think briefly, then the first line. */
  const start = () => {
    setState('starting');
    later(2200, () => setState('speaking'));
  };

  /** Reset: a short pending state, then back to the mode screen, as the status stream would switch it. */
  const onReset = () => {
    setState('resetting');
    later(900, () => void navigate('/mocks/mode'));
  };

  return { state, setState, start, onReset };
}

export type SessionMock = ReturnType<typeof useSessionMock>;
