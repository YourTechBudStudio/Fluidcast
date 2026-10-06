import { describe, expect, it } from 'vitest';

import { SessionActive, StartFailed } from '@fluidcast/app-contract';
import { TransportError } from '@yourtechbudstudio/fluidcast-client';

import { startFailureCopy } from './startFailure';

describe('startFailureCopy', () => {
  it('says what failed for each Continue reason', () => {
    expect(startFailureCopy(new StartFailed({ reason: 'InvalidSessionId' }))).toBe(
      'That isn’t a session ID. Paste the UUID Claude Code shows, like 0199b7e2-4c1d-…',
    );
    expect(startFailureCopy(new StartFailed({ reason: 'SessionNotFound' }))).toBe(
      'No Claude Code session with that ID on this machine.',
    );
    expect(startFailureCopy(new StartFailed({ reason: 'SessionUnreadable' }))).toBe(
      'Found that session, but couldn’t read its file.',
    );
    expect(startFailureCopy(new StartFailed({ reason: 'NoAnswer' }))).toBe(
      'That session has no answer yet, so there’s nothing to pick up from.',
    );
  });

  it('shows nothing for SessionActive: the status stream is already switching', () => {
    expect(startFailureCopy(new SessionActive())).toBeNull();
  });

  it('tells an unreachable backend from one that failed', () => {
    const unreachable = 'Couldn’t reach the backend. Is it running?';
    expect(startFailureCopy(new TransportError({ reason: 'Unreachable' }))).toBe(unreachable);
    expect(startFailureCopy(new TransportError({ reason: 'Closed' }))).toBe(unreachable);
    const failed = 'The backend couldn’t start the session.';
    expect(startFailureCopy(new TransportError({ reason: 'ServerError', status: 500 }))).toBe(
      failed,
    );
    expect(startFailureCopy(new TransportError({ reason: 'BadRequest', status: 400 }))).toBe(
      failed,
    );
    expect(startFailureCopy(new TransportError({ reason: 'Malformed' }))).toBe(failed);
  });
});
