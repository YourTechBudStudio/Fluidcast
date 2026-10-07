import { describe, expect, it } from 'vitest';

import { SessionActive, StartFailed } from '@fluidcast/app-contract';
import { TransportError } from '@yourtechbudstudio/fluidcast-client';

import { startFailureCopy } from './startFailure';

const noAnswer = 'That session has no answer yet, so there’s nothing to pick up from.';

describe('startFailureCopy', () => {
  it('says what failed for each Claude Code Continue reason', () => {
    const copy = (reason: StartFailed['reason']) =>
      startFailureCopy(new StartFailed({ reason }), 'claude');
    expect(copy('InvalidSessionId')).toBe(
      'That isn’t a session ID. Paste the UUID Claude Code shows, like 0199b7e2-4c1d-…',
    );
    expect(copy('SessionNotFound')).toBe('No Claude Code session with that ID on this machine.');
    expect(copy('SessionUnreadable')).toBe('Found that session, but couldn’t read its file.');
    expect(copy('NoAnswer')).toBe(noAnswer);
  });

  it('has one line for any Codex session-read failure, and names Codex for a bad ID', () => {
    const copy = (reason: StartFailed['reason']) =>
      startFailureCopy(new StartFailed({ reason }), 'codex');
    expect(copy('InvalidSessionId')).toBe(
      'That isn’t a session ID. Paste the UUID Codex shows, like 0199b7e2-4c1d-…',
    );
    expect(copy('SessionNotFound')).toBe('Couldn’t open this Codex session.');
    expect(copy('SessionUnreadable')).toBe('Couldn’t open this Codex session.');
    expect(copy('NoAnswer')).toBe(noAnswer);
  });

  it('shows nothing for SessionActive: the status stream is already switching', () => {
    expect(startFailureCopy(new SessionActive(), 'codex')).toBeNull();
  });

  it('tells an unreachable backend from one that failed', () => {
    const unreachable = 'Couldn’t reach the backend. Is it running?';
    expect(startFailureCopy(new TransportError({ reason: 'Unreachable' }), 'claude')).toBe(
      unreachable,
    );
    expect(startFailureCopy(new TransportError({ reason: 'Closed' }), 'claude')).toBe(unreachable);
    const failed = 'The backend couldn’t start the session.';
    expect(
      startFailureCopy(new TransportError({ reason: 'ServerError', status: 500 }), 'claude'),
    ).toBe(failed);
    expect(
      startFailureCopy(new TransportError({ reason: 'BadRequest', status: 400 }), 'claude'),
    ).toBe(failed);
    expect(startFailureCopy(new TransportError({ reason: 'Malformed' }), 'claude')).toBe(failed);
  });
});
