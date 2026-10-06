import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

/** What the final mode screen decides. */
export const MODE_SUMMARY =
  'One field: empty starts a new brainstorm, a pasted session ID continues it. The line under the bar says which.';

/** Every state the mode screen can be in. Error states mirror `StartFailed` reasons plus a transport failure. */
export type ModeState =
  | 'idle'
  | 'startingNew'
  | 'startingContinue'
  | 'invalid'
  | 'notFound'
  | 'unreadable'
  | 'noAnswer'
  | 'unreachable';

export const MODE_STATES: ReadonlyArray<{ readonly id: ModeState; readonly label: string }> = [
  { id: 'idle', label: 'Idle' },
  { id: 'startingNew', label: 'Starting new' },
  { id: 'startingContinue', label: 'Starting continue' },
  { id: 'invalid', label: 'Error: invalid ID' },
  { id: 'notFound', label: 'Error: not found' },
  { id: 'unreadable', label: 'Error: unreadable' },
  { id: 'noAnswer', label: 'Error: no answer' },
  { id: 'unreachable', label: 'Error: backend unreachable' },
];

/** Inline error copy, one per failure. Each line says what failed (`apps/web/AGENTS.md`). */
export const ERROR_COPY: Partial<Record<ModeState, string>> = {
  invalid: 'That isn’t a session ID. Paste the UUID Claude Code shows, like 0199b7e2-4c1d-…',
  notFound: 'No Claude Code session with that ID on this machine.',
  unreadable: 'Found that session, but couldn’t read its file.',
  noAnswer: 'That session has no answer yet, so there’s nothing to pick up from.',
  unreachable: 'Couldn’t reach the backend. Is it running?',
};

/** Errors that belong to the Continue field rather than the whole screen. */
export const isFieldError = (state: ModeState) =>
  state === 'invalid' || state === 'notFound' || state === 'unreadable' || state === 'noAnswer';

export const SAMPLE_ID = '0199b7e2-4c1d-7a3e-9f02-5d8e1c6b2a47';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const looksLikeId = (text: string) => UUID.test(text.trim());

/**
 * The mock's state lives in `?state=` so every state is linkable. Pressing a start shows its pending state briefly,
 * then returns to idle: there is no backend behind the mock.
 */
export function useModeMock() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const state = (MODE_STATES.find((s) => s.id === params.get('state'))?.id ?? 'idle') as ModeState;
  const [id, setId] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const setState = useCallback(
    (next: ModeState) =>
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next === 'idle') out.delete('state');
          else out.set('state', next);
          return out;
        },
        { replace: true },
      ),
    [setParams],
  );

  const start = useCallback(
    (mode: 'new' | 'continue') => {
      window.clearTimeout(timer.current);
      if (mode === 'continue' && !looksLikeId(id)) {
        setState('invalid');
        return;
      }
      setState(mode === 'new' ? 'startingNew' : 'startingContinue');
      // Continue hands over to the session mock; New brainstorm opens today's empty player, which isn't mocked.
      timer.current = window.setTimeout(
        () => (mode === 'continue' ? void navigate('/mocks/session') : setState('idle')),
        1800,
      );
    },
    [id, navigate, setState],
  );

  // Seed the field when a Continue-related state is picked from the mock panel, so the state reads naturally.
  useEffect(() => {
    if ((isFieldError(state) && state !== 'invalid') || state === 'startingContinue')
      setId((current) => current || SAMPLE_ID);
    if (state === 'invalid')
      setId((current) => (current && !looksLikeId(current) ? current : '0199b7e2-4c1d'));
  }, [state]);

  const busy = state === 'startingNew' || state === 'startingContinue';
  const onIdChange = (text: string) => {
    setId(text);
    if (isFieldError(state)) setState('idle');
  };
  return { state, setState, start, id, setId: onIdChange, busy };
}

export type ModeMock = ReturnType<typeof useModeMock>;

/** Where a session ID comes from. Inferred, not verified: confirm the Claude Code command before shipping the copy. */
export const ID_HINT =
  'Run /status in Claude Code, or copy it from a previous session’s Worker view.';
