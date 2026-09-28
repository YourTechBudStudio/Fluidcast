import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Schema } from 'effect';

import {
  AgentCall,
  agentErrorMarker,
  agentErrorMessage,
  agentErrorParts,
  AgentId,
  agentInput,
  TranscriptMessageJson,
  WorkerListJson,
} from './schema.ts';

describe('agent error text', () => {
  it('builds the error line, the marker and the messages, and splits them back', () => {
    const message = agentErrorMessage({
      agent: 'brainstorm',
      outcome: 'error_max_turns',
      messages: ['First.', 'Second.'],
    });
    assert.equal(
      message,
      `The worker "brainstorm" stopped with an error (error_max_turns).\n\n${agentErrorMarker}\n\nFirst.\n\nSecond.`,
    );
    assert.deepEqual(agentErrorParts(message), {
      error: 'The worker "brainstorm" stopped with an error (error_max_turns).',
      written: 'First.\n\nSecond.',
    });
  });

  it('has no marker and no written text when the worker wrote nothing', () => {
    const message = agentErrorMessage({
      agent: 'a',
      outcome: 'error_during_execution',
      messages: [],
    });
    assert.equal(message, 'The worker "a" stopped with an error (error_during_execution).');
    assert.deepEqual(agentErrorParts(message), { error: message, written: null });
  });

  it('puts the usage limit reset time on the error line, before the marker', () => {
    const message = agentErrorMessage({
      agent: 'a',
      outcome: 'usage_limit',
      resetsAt: 1_790_000_000,
      messages: ['Partial.'],
    });
    assert.deepEqual(agentErrorParts(message), {
      error:
        'The worker "a" stopped with an error (usage_limit). The usage limit resets at 2026-09-21T14:13:20.000Z.',
      written: 'Partial.',
    });
  });

  it('splits at the first marker line even when the worker wrote the marker phrase', () => {
    const written = `Notes.\n\n${agentErrorMarker}\n\nQuoted.`;
    const message = agentErrorMessage({ agent: 'a', outcome: 'x', messages: [written] });
    assert.deepEqual(agentErrorParts(message), {
      error: 'The worker "a" stopped with an error (x).',
      written,
    });
  });
});

describe('agent input', () => {
  const decode = Schema.decodeUnknownSync(agentInput(['claude']));

  it('accepts short lowercase ids and a configured type', () => {
    assert.deepEqual(decode({ agentType: 'claude', agent: 'brainstorm-2', message: 'Go.' }), {
      agentType: 'claude',
      agent: 'brainstorm-2',
      message: 'Go.',
    });
  });

  it('rejects other types, ids that differ only by case, long ids and empty messages', () => {
    assert.throws(() => decode({ agentType: 'codex', agent: 'a', message: 'Go.' }));
    assert.throws(() => decode({ agentType: 'claude', agent: 'Brainstorm', message: 'Go.' }));
    assert.throws(() => decode({ agentType: 'claude', agent: '-a', message: 'Go.' }));
    assert.throws(() => decode({ agentType: 'claude', agent: 'a'.repeat(41), message: 'Go.' }));
    assert.throws(() => decode({ agentType: 'claude', agent: 'a', message: '' }));
    assert.ok(Schema.is(AgentId)('a'.repeat(40)));
  });
});

describe('agent calls as clients read them', () => {
  const decode = Schema.decodeUnknownSync(AgentCall);

  it('accepts any type, since clients cannot know the configured ones', () => {
    assert.deepEqual(decode({ agentType: 'codex', agent: 'review', message: 'Go.' }), {
      agentType: 'codex',
      agent: 'review',
      message: 'Go.',
    });
  });

  it('rejects ids the tool rejects and empty messages', () => {
    assert.throws(() => decode({ agentType: 'claude', agent: 'Brainstorm', message: 'Go.' }));
    assert.throws(() => decode({ agentType: 'claude', agent: 'a b', message: 'Go.' }));
    assert.throws(() => decode({ agentType: 'claude', agent: 'a'.repeat(41), message: 'Go.' }));
    assert.throws(() => decode({ agentType: 'claude', agent: 'a', message: '' }));
  });
});

describe('Workers stream messages', () => {
  it('round-trip as JSON text', () => {
    const list = {
      _tag: 'WorkerList' as const,
      workers: [{ agent: 'a', agentType: 'claude', status: 'working' as const, sessionId: 's' }],
    };
    assert.deepEqual(
      Schema.decodeSync(WorkerListJson)(Schema.encodeSync(WorkerListJson)(list)),
      list,
    );
    const snapshot = {
      _tag: 'TranscriptSnapshot' as const,
      agent: 'a',
      sessionId: 's',
      entries: [
        {
          _tag: 'prompt' as const,
          parentToolUseId: null,
          source: 'fluidcast' as const,
          text: 'Hi',
        },
        { _tag: 'turnEnd' as const, parentToolUseId: null, outcome: 'usage_limit', resetsAt: 1 },
      ],
    };
    assert.deepEqual(
      Schema.decodeSync(TranscriptMessageJson)(Schema.encodeSync(TranscriptMessageJson)(snapshot)),
      snapshot,
    );
  });
});
