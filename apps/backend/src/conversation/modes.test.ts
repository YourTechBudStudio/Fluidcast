import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ReminderEvent } from '@yourtechbudstudio/fluidcast-core/generation';
import { guidedWalkthrough } from '@yourtechbudstudio/fluidcast-presets';
import { forwardToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import {
  brainstormHook,
  brainstormOpening,
  brainstormSkill,
  continueReminder,
  continueReminders,
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

describe('continueReminders', () => {
  const preset = guidedWalkthrough({ voice: { name: 'alloy' } }).reminders;
  const reminders = continueReminders(preset);

  it("gives Continue's reminder for a message read with context", () => {
    const event: ReminderEvent = {
      _tag: 'UserMessage',
      text: 'Walk me through your last answer.',
      interrupted: false,
      context: ['Your last answer in this session'],
    };
    assert.equal(reminders(event), continueReminder);
  });

  it('defers to the preset for a message without context, and for tool results', () => {
    const events: ReadonlyArray<ReminderEvent> = [
      { _tag: 'UserMessage', text: 'Hi', interrupted: false, context: [] },
      { _tag: 'UserMessage', text: 'Wait', interrupted: true, context: [] },
      { _tag: 'ToolResult', tool: forwardToolName, result: { messages: ['Done.'] } },
    ];
    for (const event of events) assert.equal(reminders(event), preset(event));
    assert.notEqual(reminders(events[0]!), undefined);
  });

  it("ends with the preset's evaluated reply reminder, verbatim, after one framing sentence", () => {
    const reply = preset({ _tag: 'ToolResult', tool: forwardToolName, result: { messages: [] } });
    assert.ok(reply !== undefined && continueReminder.endsWith(` ${reply}`));
  });
});
