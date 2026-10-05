/**
 * Prompt assembly for the eval. Tools are the production schemas with swappable guidelines and
 * result rendering; history renders through Core's real `renderHistory` (XML envelopes, reminders
 * after the newest input), so only the text the variants own changes.
 */
import { Schema } from 'effect';

import { ModelSpeak, type Action } from '../../../packages/core/src/actions/index.ts';
import type { Example } from '../../../packages/core/src/generation/examples.ts';
import { renderExample, renderHistory } from '../../../packages/core/src/generation/history.ts';
import {
  buildSystemPrompt,
  outputJsonSchema,
} from '../../../packages/core/src/generation/prompt.ts';
import type { Reminders } from '../../../packages/core/src/generation/reminders.ts';
import { renderTypeScript } from '../../../packages/core/src/generation/render-type.ts';
import { modelSchema, type ToolDefinition } from '../../../packages/core/src/generation/tools.ts';
import { ForwardInput, ForwardResult } from '../../../packages/tool-agent/src/schema.ts';
import { AskInput, AskResult } from '../../../packages/tool-ask/src/schema.ts';
import { ShowInput, ShowResult } from '../../../packages/tool-show/src/schema.ts';
import type { ChatMessage } from './model.ts';

export type { Action, Example, Reminders };

/** Production tool guidelines (copied from the tool packages, current working tree). */
export const productionGuidelines = {
  show: [
    'Use `show` to put material in front of the listener: lists, tables, a decision with its reasons, options, flows. Speech explains it; the `show` holds it.',
    'Use `show` with `mermaid` for every diagram, writing only the Mermaid source, never a code fence.',
    'Use `show` with `markdown` for text, lists and tables, and with `html` only for layouts or small interactive demos Markdown cannot express. HTML scripts run.',
    'Each `show` is complete and replaces the previous one. To build on a diagram, send the whole diagram again.',
  ],
  ask: [
    "Use `ask` for a question that needs the listener's answer: a question you only speak gets no answer. Rhetorical questions in speech are fine.",
    'Each `ask` holds exactly one question. Split a compound question into separate `ask`s.',
    'Use `kind: "choice"` or `"multi"` when the likely answers are known, with short labels and optional one-line descriptions drawn from what you have said. The listener can always answer in their own words instead.',
    '`ask` blocks: what you write after it still plays, then the conversation waits for the answer, and other tool results wait with it. The answer arrives as a `<tool_result>` in the next input.',
  ],
  forward: [
    'Write `forward` (just `{"type":"forward"}`, it has no fields) as the first action of your response whenever you forward, so the work starts at once. It carries the listener\'s exact words and what you said and showed since the last `forward`.',
    'After `forward`, say a short line or two that buys time, such as "Let me think about that." or "Give me a moment to look.", then stop and wait for its result. Until it arrives, do not answer, confirm, agree with or decide anything: you do not know yet.',
    'Forwarding while earlier work is still running steers that work; one result then answers every `forward` it took in (`calls="…"`).',
    'While you wait, a `<tool_progress>` from `forward` says what you are doing: say it in one short first-person line, such as "I\'m reading the tests now."',
    'A `forward` result arrives split into numbered parts. Present it as a faithful compressor, in the first person, part by part in its order: each part gets one or more compact shows (short bullets, a table for comparisons, a diagram for flows), never one big show for the whole reply, and no part is skipped. Before every `show`, say one or two sentences that point at what matters in it, without reading the screen out; never write two `show`s in a row without speech between them, since each one replaces the last. Keep every decision, reason, risk, caveat, number, option and question; leave out only wording, and add nothing of your own.',
    'When a `forward` result gives text meant to be used exactly as written (a paste-ready brief, a command, code, an amendment block, a draft to post), show it verbatim on screen instead of rewording it.',
    'The questions a `forward` result lists are your questions to the listener: finish with them, in plain words with their options, then stop. When the listener answers, forward the answer straight away, like everything else.',
  ],
};

export type ToolText = {
  show: ReadonlyArray<string>;
  ask: ReadonlyArray<string>;
  forward: ReadonlyArray<string>;
  /** What the model reads inside a forward `<tool_result>`. Default: the messages, joined. */
  renderForward?: (messages: ReadonlyArray<string>) => string;
  /** The forward tool's model-facing name. Default `forward`; the runner treats any name as forward. */
  forwardName?: string;
  /** false: the `ask` options have only a `label` (no `description` field in the schema or the enforced JSON). */
  askOptionDescriptions?: boolean;
  /** Ask's default reminder. Default: production (interrupted answer → forward now). */
  askReminder?: (result: AskResult) => string | undefined;
};

/** The production `ask` input without option descriptions: options are bare labels. */
const BareOption = Schema.Struct({
  label: Schema.String.annotate({ description: 'A short answer the listener can pick.' }),
});
const BareOptions = Schema.Array(BareOption).check(Schema.isMinLength(1));
const BareQuestion = Schema.String.annotate({ description: 'Exactly one question.' });
const AskInputBare = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('text'), question: BareQuestion }),
  Schema.Struct({ kind: Schema.Literal('choice'), question: BareQuestion, options: BareOptions }),
  Schema.Struct({ kind: Schema.Literal('multi'), question: BareQuestion, options: BareOptions }),
]);

const renderAnswer = ({ question, answer }: AskResult): string => {
  const lines = [`Question: ${question}`];
  if (answer.interrupted === true && answer.kind === 'text') {
    lines.push(`The listener interrupted to say: ${answer.text}`);
    return lines.join('\n');
  }
  if (answer.interrupted === true) lines.push('The listener interrupted to answer.');
  switch (answer.kind) {
    case 'text':
      lines.push(`Answer, in their own words: ${answer.text}`);
      break;
    case 'choice':
      lines.push(`Answer: ${answer.choice}`);
      break;
    case 'multi':
      lines.push(`Answer: ${answer.choices.join('; ')}`);
      break;
  }
  if (answer.kind !== 'text' && answer.text !== undefined && answer.text.trim() !== '') {
    lines.push(`They added: ${answer.text.trim()}`);
  }
  return lines.join('\n');
};

export const buildTools = (text: ToolText): Array<ToolDefinition> => [
  {
    name: 'show',
    input: ShowInput,
    guidelines: text.show,
    result: ShowResult,
    renderResult: () => 'Shown.',
  },
  {
    name: 'ask',
    input: text.askOptionDescriptions === false ? AskInputBare : AskInput,
    guidelines: text.ask,
    result: AskResult,
    renderResult: renderAnswer,
    reminder:
      text.askReminder ??
      (({ answer }) =>
        answer.interrupted === true
          ? 'The listener interrupted: forward their words now.'
          : undefined),
  },
  {
    name: text.forwardName ?? 'forward',
    input: ForwardInput,
    guidelines: text.forward,
    result: ForwardResult,
    renderResult: ({ messages }) => (text.renderForward ?? ((m) => m.join('\n\n')))(messages),
    renderCall: () => ({}),
  },
];

export const speakers = [
  {
    id: 'host',
    name: 'Host',
    personality: 'Warm, curious and engaging. Explains things plainly, like a good storyteller.',
  },
];

/** Pieces a variant composes its own system prompt from. */
export type PromptParts = {
  outputType: string;
  examples: (examples: ReadonlyArray<Example>) => string;
  toolRules: string;
  speakersBlock: string;
};

export const promptParts = (
  tools: ReadonlyArray<ToolDefinition>,
  speaker: { name: string; personality: string } = speakers[0]!,
): PromptParts => ({
  outputType: renderTypeScript(
    Schema.Union([ModelSpeak, ...tools.map(modelSchema)]).annotate({ identifier: 'Action' }),
  ),
  examples: (examples) => examples.map((e) => renderExample(e, tools, 'host')).join('\n\n'),
  toolRules: [...new Set(tools.flatMap((tool) => tool.guidelines))].map((g) => `- ${g}`).join('\n'),
  speakersBlock: [
    '<speakers>',
    `- host (lead): ${speaker.name}. ${speaker.personality}`,
    '</speakers>',
  ].join('\n'),
});

/** Core's production system prompt for these tools. */
export const productionSystem = (
  tools: ReadonlyArray<ToolDefinition>,
  instructions: string,
  examples: ReadonlyArray<Example>,
) => buildSystemPrompt({ instructions, examples, speakers, tools });

export const jsonSchemaFor = (tools: ReadonlyArray<ToolDefinition>) =>
  outputJsonSchema({ speakers, tools });

export const renderMessages = (
  system: string,
  history: ReadonlyArray<Action>,
  tools: ReadonlyArray<ToolDefinition>,
  reminders: Reminders | undefined,
): Array<ChatMessage> => [
  { role: 'system', content: system },
  ...(renderHistory(
    history,
    tools,
    reminders === undefined ? {} : { reminders },
  ) as Array<ChatMessage>),
];
