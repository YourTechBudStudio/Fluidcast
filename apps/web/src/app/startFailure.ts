import type { SessionActive, StartFailed } from '@fluidcast/app-contract';
import type { TransportError } from '@yourtechbudstudio/fluidcast-client';

/** Why a start failed. */
export type StartError = StartFailed | SessionActive | TransportError;

const REASON_COPY: Record<StartFailed['reason'], string> = {
  InvalidSessionId:
    'That isn’t a session ID. Paste the UUID Claude Code shows, like 0199b7e2-4c1d-…',
  SessionNotFound: 'No Claude Code session with that ID on this machine.',
  SessionUnreadable: 'Found that session, but couldn’t read its file.',
  NoAnswer: 'That session has no answer yet, so there’s nothing to pick up from.',
};

/**
 * The mode screen's failure line, which always says what failed. `null` for `SessionActive`: a session is already live,
 * and the status stream is already taking the page to it.
 */
export function startFailureCopy(error: StartError): string | null {
  switch (error._tag) {
    case 'StartFailed':
      return REASON_COPY[error.reason];
    case 'SessionActive':
      return null;
    case 'TransportError':
      return error.reason === 'Unreachable' || error.reason === 'Closed'
        ? 'Couldn’t reach the backend. Is it running?'
        : 'The backend couldn’t start the session.';
  }
}
