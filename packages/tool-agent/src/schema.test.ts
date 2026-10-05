import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Schema } from 'effect';

import {
  forwardErrorMarker,
  forwardErrorMessage,
  forwardErrorParts,
  ForwardInput,
  TranscriptMessageJson,
  WorkerSummaryJson,
} from './schema.ts';

describe('forward error text', () => {
  it('builds the error line, the marker and the messages, and splits them back', () => {
    const message = forwardErrorMessage({
      outcome: 'error_max_turns',
      messages: ['First.', 'Second.'],
    });
    assert.equal(
      message,
      `The work stopped with an error (error_max_turns).\n\n${forwardErrorMarker}\n\nFirst.\n\nSecond.`,
    );
    assert.deepEqual(forwardErrorParts(message), {
      error: 'The work stopped with an error (error_max_turns).',
      written: 'First.\n\nSecond.',
    });
  });

  it('has no marker and no written text when the worker wrote nothing', () => {
    const message = forwardErrorMessage({
      outcome: 'error_during_execution',
      messages: [],
    });
    assert.equal(message, 'The work stopped with an error (error_during_execution).');
    assert.deepEqual(forwardErrorParts(message), { error: message, written: null });
  });

  it('puts the usage limit reset time on the error line, before the marker', () => {
    const message = forwardErrorMessage({
      outcome: 'usage_limit',
      resetsAt: 1_790_000_000,
      messages: ['Partial.'],
    });
    assert.deepEqual(forwardErrorParts(message), {
      error:
        'The work stopped with an error (usage_limit). The usage limit resets at 2026-09-21T14:13:20.000Z.',
      written: 'Partial.',
    });
  });

  it('splits at the first marker line even when the worker wrote the marker phrase', () => {
    const written = `Notes.\n\n${forwardErrorMarker}\n\nQuoted.`;
    const message = forwardErrorMessage({ outcome: 'x', messages: [written] });
    assert.deepEqual(forwardErrorParts(message), {
      error: 'The work stopped with an error (x).',
      written,
    });
  });
});

describe('forward input', () => {
  const decode = Schema.decodeUnknownSync(ForwardInput);

  it('is empty, and accepts fields the model adds', () => {
    assert.deepEqual(decode({}), {});
    assert.doesNotThrow(() => decode({ task: 'stray' }));
    assert.deepEqual(Object.keys(ForwardInput.fields), []);
  });
});

describe('Worker stream messages', () => {
  it('round-trip as JSON text', () => {
    const summary = { _tag: 'WorkerSummary' as const, status: 'working' as const, sessionId: 's' };
    assert.deepEqual(
      Schema.decodeSync(WorkerSummaryJson)(Schema.encodeSync(WorkerSummaryJson)(summary)),
      summary,
    );
    const snapshot = {
      _tag: 'TranscriptSnapshot' as const,
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
