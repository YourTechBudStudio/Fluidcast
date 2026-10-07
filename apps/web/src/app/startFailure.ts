import type { Agent, SessionActive, StartFailed } from '@fluidcast/app-contract';
import type { TransportError } from '@yourtechbudstudio/fluidcast-client';

import { AGENT_NAME } from './agents';

/** Why a start failed. */
export type StartError = StartFailed | SessionActive | TransportError;

/** A Continue failure, for the agent the session was started with. */
function reasonCopy(reason: StartFailed['reason'], agent: Agent): string {
  switch (reason) {
    case 'InvalidSessionId':
      return `That isn’t a session ID. Paste the UUID ${AGENT_NAME[agent]} shows, like 0199b7e2-4c1d-…`;
    case 'NoAnswer':
      return 'That session has no answer yet, so there’s nothing to pick up from.';
    case 'SessionNotFound':
    case 'SessionUnreadable':
      // Codex cannot tell a missing session from an unreadable one, so it has one line for both.
      if (agent === 'codex') return 'Couldn’t open this Codex session.';
      return reason === 'SessionNotFound'
        ? 'No Claude Code session with that ID on this machine.'
        : 'Found that session, but couldn’t read its file.';
  }
}

/**
 * The mode screen's failure line, which always says what failed. `agent` is the one the failed start used: the pills are
 * read-only while starting, and switching agent clears a Continue failure. `null` for `SessionActive`: a session is already live,
 * and the status stream is already taking the page to it.
 */
export function startFailureCopy(error: StartError, agent: Agent): string | null {
  switch (error._tag) {
    case 'StartFailed':
      return reasonCopy(error.reason, agent);
    case 'SessionActive':
      return null;
    case 'TransportError':
      return error.reason === 'Unreachable' || error.reason === 'Closed'
        ? 'Couldn’t reach the backend. Is it running?'
        : 'The backend couldn’t start the session.';
  }
}
