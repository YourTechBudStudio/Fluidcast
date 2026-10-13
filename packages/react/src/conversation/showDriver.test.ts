import { describe, expect, it } from 'vitest';

import { TransportError } from '@yourtechbudstudio/fluidcast-client';
import {
  CommandRejected,
  type Execution,
  type ExecutionId,
  ToolCommandRejected,
} from '@yourtechbudstudio/fluidcast-harness/protocol';

import { reportActionOf, retryDelay, unseenShows } from './showDriver';

describe('reportActionOf', () => {
  it('is done once accepted, stale, or rejected by a session that takes no commands', () => {
    expect(reportActionOf({ _tag: 'Accepted' })).toEqual({ kind: 'reported', accepted: true });
    expect(reportActionOf(new ToolCommandRejected({ executionId: 'e1', reason: 'stale' }))).toEqual(
      { kind: 'reported', accepted: false },
    );
    expect(
      reportActionOf(new CommandRejected({ command: 'ToolCommand', phase: 'halted' })),
    ).toEqual({ kind: 'reported', accepted: false });
  });

  it('leaves an invalid report unresolved, without retrying', () => {
    expect(
      reportActionOf(new ToolCommandRejected({ executionId: 'e1', reason: 'invalid' })),
    ).toEqual({ kind: 'unresolved' });
  });

  it('leaves a report the backend cannot accept unresolved, without retrying', () => {
    for (const reason of ['BadRequest', 'Malformed'] as const) {
      expect(reportActionOf(new TransportError({ reason, status: 400 }))).toEqual({
        kind: 'unresolved',
      });
    }
  });

  it('retries when the backend cannot be reached or fails while handling the report', () => {
    for (const reason of ['Unreachable', 'Closed', 'ServerError'] as const) {
      const failure = new TransportError({ reason });
      expect(reportActionOf(failure)).toEqual({ kind: 'retry', failure });
    }
  });
});

describe('retryDelay', () => {
  it('backs off exponentially from 250 ms, capped at 4 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([250, 500, 1000, 2000, 4000, 4000, 4000]);
  });
});

describe('unseenShows', () => {
  const execution = (id: string, handle: string, tool = 'show'): Execution => ({
    executionId: id as ExecutionId,
    handles: [handle],
    tool,
    blocking: tool === 'ask',
    startedAt: 0,
  });

  it('opens the panel for a Show execution not seen before, including a replay of a seen call', () => {
    const seen = new Set(['e1' as ExecutionId]);
    const executions = [
      execution('e1', 'call_1'),
      execution('e2', 'call_1'),
      execution('e3', 'call_2', 'ask'),
      execution('e4', 'call_3'),
    ];
    expect(unseenShows(executions, seen).map((e) => e.executionId)).toEqual(['e2', 'e4']);
  });
});
