import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderHandoff, type ConversationEntry } from '@yourtechbudstudio/fluidcast-tool-agent';
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
  const conversation: ReadonlyArray<ConversationEntry> = [
    { kind: 'voice', speaker: undefined, text: 'Here is the plan.' },
    { kind: 'user', text: '/designing-ui three mockups' },
  ];

  it('starts the brainstorming skill with the opening line and the normal text on the first message', () => {
    const plain = {
      conversation: [{ kind: 'user', text: 'Hi.' }] as const,
      rendered: 'UNUSED',
      isFirstMessage: true,
      modifiers: [],
    };
    assert.deepEqual(brainstormHook(plain), {
      prompt: `${brainstormOpening}\n\n${renderHandoff(plain)}`,
      modifiers: [{ name: brainstormSkill }],
    });
    assert.equal(brainstormSkill, 'brainstorming');
    assert.equal(brainstormOpening, "Let's brainstorm this in phases.");
  });

  it("ignores a skill typed on the first message: the listener's words and the narration go as typed", () => {
    const typed = {
      conversation,
      rendered: 'SKILL TEXT',
      isFirstMessage: true,
      modifiers: [{ name: 'designing-ui' }],
    };
    const hooked = brainstormHook(typed);
    assert.deepEqual(hooked.modifiers, [{ name: brainstormSkill }]);
    assert.equal(hooked.prompt, `${brainstormOpening}\n\n${renderHandoff(typed)}`);
    assert.ok(hooked.prompt.includes('**User:** /designing-ui three mockups'), hooked.prompt);
    assert.ok(hooked.prompt.includes('**Voice:** Here is the plan.'), hooked.prompt);
    assert.ok(!hooked.prompt.includes('SKILL TEXT'), hooked.prompt);
  });

  it("passes later messages through: the rendered text and the listener's modifiers", () => {
    assert.deepEqual(
      brainstormHook({
        conversation,
        rendered: 'SKILL TEXT',
        isFirstMessage: false,
        modifiers: [{ name: 'designing-ui' }],
      }),
      { prompt: 'SKILL TEXT', modifiers: [{ name: 'designing-ui' }] },
    );
    assert.deepEqual(
      brainstormHook({ conversation: [], rendered: 'LATER', isFirstMessage: false, modifiers: [] }),
      { prompt: 'LATER', modifiers: [] },
    );
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
