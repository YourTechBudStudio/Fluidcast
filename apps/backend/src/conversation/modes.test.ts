import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { forwardToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import {
  brainstormHook,
  brainstormOpening,
  brainstormSkill,
  continueCallLabel,
  continueMessage,
  continueStart,
} from './modes.ts';

describe('brainstormHook', () => {
  it('starts the brainstorming skill with the opening line on the first message only', () => {
    const first = brainstormHook({ conversation: [], rendered: 'HANDOFF', isFirstMessage: true });
    assert.deepEqual(first, {
      prompt: `${brainstormOpening}\n\nHANDOFF`,
      modifiers: [{ name: brainstormSkill }],
    });
    assert.equal(brainstormSkill, 'brainstorming');
    assert.equal(brainstormOpening, "Let's brainstorm this in phases.");

    const later = brainstormHook({ conversation: [], rendered: 'LATER', isFirstMessage: false });
    assert.deepEqual(later, { prompt: 'LATER' });
  });
});

describe('continueStart', () => {
  it('opens with the message, then the last answer as an answered forward_agent call', () => {
    assert.deepEqual(continueStart('The answer.'), {
      message: continueMessage,
      call: {
        label: continueCallLabel,
        tool: forwardToolName,
        input: {},
        result: { messages: ['The answer.'] },
      },
    });
    assert.equal(continueMessage, 'Walk me through your last answer.');
    assert.equal(continueCallLabel, 'Your last answer in this session');
  });
});
