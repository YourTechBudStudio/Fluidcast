import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  buildSystemPrompt,
  type ReminderEvent,
} from '@yourtechbudstudio/fluidcast-core/generation';
import { forwardAgentDefinition } from '@yourtechbudstudio/fluidcast-tool-agent';
import { askTool, type AskCommand } from '@yourtechbudstudio/fluidcast-tool-ask';
import { showTool } from '@yourtechbudstudio/fluidcast-tool-show';

import { guidedWalkthrough } from '../index.ts';
import { reminderTexts } from './reminders.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const voice = { name: 'alloy', instructions: 'Speak warmly.' };
const tools = [showTool(), askTool(), forwardAgentDefinition];

const render = (preset: ReturnType<typeof guidedWalkthrough>) =>
  buildSystemPrompt({ ...preset, tools });

/** The text from `start` up to (not including) `end`, or to the end of the text. */
const section = (text: string, start: string, end?: string): string => {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  if (end === undefined) return text.slice(from).trimEnd();
  const to = text.indexOf(end, from);
  assert.notEqual(to, -1, `missing ${end}`);
  return text.slice(from, to).trimEnd();
};

const progressBullet =
  '- While you wait, a `<tool_progress>` from `forward_agent` says what you are doing: say it in one short first-person line, then keep waiting for its result.';

/*
 * The detailed preset, rendered by Core with the real tools, against the evaluated prompt
 * (`fixtures/evaluated-detailed.txt`). Every evaluated section appears verbatim. The expected
 * differences:
 * 1. `<speakers>` sits after `## Speaking`, not between `## Forwarding` and `## Speaking`: Core
 *    puts the instructions first, whole.
 * 2. Core's mechanics bullets lead `## Tool rules`.
 * 3. "Never write a `call` field." lives in those bullets, not after "Respond with only a JSON
 *    array of `Action`. No prose outside it."
 * 4. `## Forwarding` ends with the added progress bullet.
 * 5. The interrupted-question example shows an interrupt cancelling the question (a notice, then
 *    the listener's message) instead of an interrupted answer, which Ask no longer has.
 */
describe('the detailed Guided Walkthrough', () => {
  const evaluated = fixture('evaluated-detailed.txt');
  const rendered = render(guidedWalkthrough({ voice }));

  it('matches the committed rendering', () => {
    assert.equal(rendered, fixture('rendered-detailed.txt'));
  });

  it('has the evaluated instruction sections verbatim, plus the progress bullet', () => {
    for (const [start, end] of [
      ['## Role', '## Walking through'],
      ['## Walking through', '## Forwarding'],
    ] as const) {
      assert.equal(section(rendered, start, end), section(evaluated, start, end), start);
    }
    assert.equal(
      section(rendered, '## Speaking', '<speakers>'),
      section(evaluated, '## Speaking', '## Tool rules'),
    );
    assert.equal(
      section(rendered, '## Forwarding', '## Speaking'),
      `${section(evaluated, '## Forwarding', '<speakers>')}\n${progressBullet}`,
    );
    assert.equal(
      section(rendered, '<speakers>', '## Tool rules'),
      section(evaluated, '<speakers>', '## Speaking'),
    );
  });

  it('has the evaluated tool lines, output-format types and examples verbatim, but the interrupted question', () => {
    const evaluatedRules = section(evaluated, '## Tool rules', '## Output format').split('\n');
    const renderedRules = section(rendered, '## Tool rules', '## Output format').split('\n');
    assert.deepEqual(renderedRules.slice(-3), evaluatedRules.slice(1));
    assert.equal(renderedRules.length, 1 + 5 + 3);
    assert.equal(section(rendered, '```ts', '```\n'), section(evaluated, '```ts', '```\n'));
    const answered =
      '<tool_result call="call_1" tool="ask">Question: Ready for the fixes?\nThe listener interrupted to say: Wait, why not just fix the database instead?</tool_result>';
    const declined =
      '<notice>The user interrupted to say something.</notice>\n<user_message>Wait, why not just fix the database instead?</user_message>';
    assert.ok(evaluated.includes(answered));
    assert.equal(
      section(rendered, '## Examples'),
      section(evaluated, '## Examples').replace(answered, declined),
    );
  });
});

describe('guidedWalkthrough profiles', () => {
  it('compact has the protocol only: no Speaking section and no examples', () => {
    const compact = guidedWalkthrough({ profile: 'compact', voice });
    const prompt = render(compact);
    assert.deepEqual(compact.examples, []);
    assert.doesNotMatch(prompt, /## Speaking|## Examples/);
    assert.ok(compact.instructions.endsWith(progressBullet));
    assert.ok(compact.instructions.startsWith('## Role\n'));
  });

  it('defaults to detailed', () => {
    const preset = guidedWalkthrough({ voice });
    assert.deepEqual(preset, guidedWalkthrough({ profile: 'detailed', voice }));
    assert.ok(preset.instructions.includes('\n\n## Speaking\n'));
    assert.equal(preset.examples.length, 5);
  });

  it('returns one host speaker with the given voice, in both profiles', () => {
    for (const profile of ['compact', 'detailed'] as const) {
      const { speakers } = guidedWalkthrough({ profile, voice });
      assert.deepEqual(speakers, [
        {
          id: 'host',
          name: 'Host',
          personality:
            'Warm, curious and engaging. Explains things plainly, like a good storyteller.',
          voice,
        },
      ]);
    }
  });
});

describe('guidedWalkthrough reminders', () => {
  const { reminders } = guidedWalkthrough({ voice });
  const ask = (answer: AskCommand): ReminderEvent => ({
    _tag: 'ToolResult',
    tool: 'ask',
    result: { question: 'Ready?', answer },
  });

  it('reminds to present the first segment of a forward result', () => {
    assert.equal(
      reminders({ _tag: 'ToolResult', tool: 'forward_agent', result: { messages: ['Done.'] } }),
      reminderTexts.reply,
    );
  });

  it('reminds to present the next segment after a Continue, chosen or typed', () => {
    assert.equal(reminders(ask({ kind: 'choice', choice: 'Continue' })), reminderTexts.continue);
    assert.equal(reminders(ask({ kind: 'text', text: '  go on, please' })), reminderTexts.continue);
    assert.equal(reminders(ask({ kind: 'text', text: 'Keep going' })), reminderTexts.continue);
  });

  it('treats any other answer as an answer, including a choice with "continue" typed beside it', () => {
    assert.equal(reminders(ask({ kind: 'choice', choice: 'Yes' })), reminderTexts.answer);
    assert.equal(
      reminders(ask({ kind: 'choice', choice: 'Yes', text: 'continue' })),
      reminderTexts.answer,
    );
    assert.equal(reminders(ask({ kind: 'text', text: 'Not yet' })), reminderTexts.answer);
    assert.equal(reminders(ask({ kind: 'multi', choices: ['Continue'] })), reminderTexts.answer);
  });

  it('reminds to forward first after an interrupting message', () => {
    assert.equal(
      reminders({ _tag: 'UserMessage', text: 'Wait', interrupted: true }),
      reminderTexts.interrupt,
    );
  });

  it('reminds to forward any other user message unless it is small talk', () => {
    assert.equal(
      reminders({ _tag: 'UserMessage', text: 'Why?', interrupted: false }),
      reminderTexts.message,
    );
  });

  it('has no reminder for another tool', () => {
    assert.equal(reminders({ _tag: 'ToolResult', tool: 'show', result: {} }), undefined);
  });
});
