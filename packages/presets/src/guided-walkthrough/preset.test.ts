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

const segmentBullet =
  '- A segment is one compact `show`. Introduce it in one short line, `show` it, then walk the listener through it while they look at it.';
const evaluatedSegmentBullet =
  '- A segment is one to three compact `show`s, each after a sentence or two of speech.';

const continueAskClause =
  'otherwise one `ask` with `kind: "continue"` and a short question such as "Ready for the next part?".';
const evaluatedContinueAskClause =
  'otherwise one `ask` with `kind: "choice"`, a short question such as "Ready for the next part?" and the single option "Continue".';

const askGuideline =
  '- Use `ask` for one question that needs the listener\'s answer. `ask` blocks: the conversation waits for the answer, which arrives as a `<tool_result>`. `kind: "continue"` is a checkpoint the listener only acknowledges with a Continue button; every other kind can also be answered in the listener\'s own words.';
const evaluatedAskGuideline =
  "- Use `ask` for one question that needs the listener's answer. `ask` blocks: the conversation waits for the answer, which arrives as a `<tool_result>`. The listener can always answer in their own words.";

/** The `Ask` type's last branch, `multi`, and the `continue` branch that now follows it. */
const evaluatedAskTypeEnd = '    label: string;\n  }[];\n};\n\n/** Starts your work';
const askTypeEnd =
  '    label: string;\n  }[];\n} | {\n  type: "ask";\n  kind: "continue";\n  /** Exactly one question. */\n  question: string;\n};\n\n/** Starts your work';

/** An example's Continue checkpoint, as a `continue` ask and as the evaluated single-option choice. */
const continueAsk = (question: string) =>
  `{"type":"ask","kind":"continue","question":"${question}"}`;
const evaluatedContinueAsk = (question: string) =>
  `{"type":"ask","kind":"choice","question":"${question}","options":[{"label":"Continue"}]}`;
const continueQuestions = ['Ready to send your answer?', 'Ready for the fixes?'];

/** Replaces `from` with `to` in `text`, asserting that `from` occurs exactly once. */
const swap = (text: string, from: string, to: string): string => {
  assert.equal(text.split(from).length, 2, `expected exactly one ${from}`);
  return text.replace(from, () => to);
};

/** The examples' walk-through lines: the run of speaks right before an `ask`, which follows a screen. */
const walkThroughSpeech =
  /(?:,\{"type":"speak","speaker":"host","text":"(?:[^"\\]|\\.)*"\})+(?=,\{"type":"ask")/g;

/*
 * The detailed preset, rendered by Core with the real tools, against the evaluated prompt
 * (`fixtures/evaluated-detailed.txt`). The expected differences:
 * 1. `<speakers>` sits after `## Speaking`, not between `## Forwarding` and `## Speaking`: Core
 *    puts the instructions first, whole.
 * 2. Core's mechanics bullets lead `## Tool rules`.
 * 3. "Never write a `call` field." lives in those bullets, not after "Respond with only a JSON
 *    array of `Action`. No prose outside it."
 * 4. `## Forwarding` ends with the added progress bullet.
 * 5. The interrupted-question example shows an interrupt cancelling the question (a notice, then
 *    the listener's message) instead of an interrupted answer, which Ask no longer has.
 * 6. Walk-through speech: the segment bullet, a new `## Speaking` section, and short speaks after
 *    each example screen, one per point, that walk the listener through it.
 * 7. The `continue` Ask kind: the segment-ending ask bullet asks with `kind: "continue"` instead of a
 *    choice with the single option "Continue"; the `Ask` type gains a `continue` branch; the `ask`
 *    guideline names it; and the examples' two Continue asks use it. Their results still read
 *    `Answer: Continue`.
 */
describe('the detailed Guided Walkthrough', () => {
  const evaluated = fixture('evaluated-detailed.txt');
  const rendered = render(guidedWalkthrough({ voice }));

  it('matches the committed rendering', () => {
    assert.equal(rendered, fixture('rendered-detailed.txt'));
  });

  it('has the evaluated role and forwarding, plus the progress bullet, and walk-through speech', () => {
    assert.equal(
      section(rendered, '## Role', '## Walking through'),
      section(evaluated, '## Role', '## Walking through'),
    );
    assert.equal(
      section(rendered, '## Walking through', '## Forwarding'),
      swap(
        swap(
          section(evaluated, '## Walking through', '## Forwarding'),
          evaluatedSegmentBullet,
          segmentBullet,
        ),
        evaluatedContinueAskClause,
        continueAskClause,
      ),
    );
    assert.equal(
      section(rendered, '## Forwarding', '## Speaking'),
      `${section(evaluated, '## Forwarding', '<speakers>')}\n${progressBullet}`,
    );
    assert.match(
      section(rendered, '## Speaking', '<speakers>'),
      /Speech gives them its highlights/,
    );
    assert.equal(
      section(rendered, '<speakers>', '## Tool rules'),
      section(evaluated, '<speakers>', '## Speaking'),
    );
  });

  it('has the evaluated tool lines, output-format types and examples, but the interrupted question, walk-through speech and the continue kind', () => {
    const evaluatedRules = section(evaluated, '## Tool rules', '## Output format').split('\n');
    const renderedRules = section(rendered, '## Tool rules', '## Output format').split('\n');
    assert.ok(evaluatedRules.includes(evaluatedAskGuideline));
    assert.deepEqual(
      renderedRules.slice(-3),
      evaluatedRules.slice(1).map((line) => (line === evaluatedAskGuideline ? askGuideline : line)),
    );
    assert.equal(renderedRules.length, 1 + 5 + 3);
    assert.equal(
      section(rendered, '```ts', '```\n'),
      swap(section(evaluated, '```ts', '```\n'), evaluatedAskTypeEnd, askTypeEnd),
    );
    const answered =
      '<tool_result call="call_1" tool="ask">Question: Ready for the fixes?\nThe listener interrupted to say: Wait, why not just fix the database instead?</tool_result>';
    const declined =
      '<notice>The user interrupted to say something.</notice>\n<user_message>Wait, why not just fix the database instead?</user_message>';
    assert.ok(evaluated.includes(answered));
    const renderedExamples = section(rendered, '## Examples');
    assert.equal(renderedExamples.match(walkThroughSpeech)?.length, 4);
    const evaluatedExamples = continueQuestions.reduce(
      (text, question) => swap(text, evaluatedContinueAsk(question), continueAsk(question)),
      swap(section(evaluated, '## Examples'), answered, declined),
    );
    assert.equal(renderedExamples.replace(walkThroughSpeech, ''), evaluatedExamples);
    assert.ok(
      renderedExamples.includes(
        '<tool_result call="call_9" tool="ask">Question: Ready to send your answer?\nAnswer: Continue</tool_result>',
      ),
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
    assert.ok(compact.instructions.includes(segmentBullet));
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

  it('reminds to present the next segment after a continue answer', () => {
    assert.equal(reminders(ask({ kind: 'continue' })), reminderTexts.continue);
  });

  it('treats any other answer as an answer, however it reads', () => {
    assert.equal(reminders(ask({ kind: 'choice', choice: 'Continue' })), reminderTexts.answer);
    assert.equal(reminders(ask({ kind: 'text', text: '  go on, please' })), reminderTexts.answer);
    assert.equal(reminders(ask({ kind: 'text', text: 'next' })), reminderTexts.answer);
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
      reminders({ _tag: 'UserMessage', text: 'Wait', interrupted: true, context: [] }),
      reminderTexts.interrupt,
    );
  });

  it('reminds to forward any other user message unless it is small talk', () => {
    assert.equal(
      reminders({ _tag: 'UserMessage', text: 'Why?', interrupted: false, context: [] }),
      reminderTexts.message,
    );
  });

  it('has no reminder for another tool', () => {
    assert.equal(reminders({ _tag: 'ToolResult', tool: 'show', result: {} }), undefined);
  });
});
