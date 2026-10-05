import type { ToolDefinition } from '../../../packages/core/src/generation/tools.ts';
/** Building blocks for variants: the production reference and drive generation 1. Generated variants import from here. */
import { renderForwardResult } from '../../../packages/tool-agent/src/presentation.ts';
import type { Variant } from '../lib/drive.ts';
import {
  productionGuidelines,
  productionSystem,
  type Example,
  type PromptParts,
} from '../lib/prompt.ts';
import { driveReminders, prod, prodReminders, type DriveReminderText } from './common.ts';

// ---------------------------------------------------------------------------------------------
// Reference: production flow mode (parts rendering, production prompt/examples/reminders).

export const prodFlow: Variant = {
  id: 'prod-flow',
  notes:
    'Production flow mode as of the working tree: parts rendering, Core role, yaml examples and reminders.',
  tools: {
    ...productionGuidelines,
    renderForward: (messages) => renderForwardResult({ messages }),
  },
  system: (tools) => productionSystem(tools, prod.instructions, prod.examples),
  examples: prod.examples,
  reminders: () => prodReminders,
  pause: 'natural',
};

// ---------------------------------------------------------------------------------------------
// Drive mode, generation 1.

const invoiceReply = `**Cause**
Invoice totals are off because the PDF export rounds tax on each line, while the database rounds once per invoice, so totals drift by a few cents.

**Fix options**
1. Round once per invoice in the export too. A small change, but reprints of old invoices will no longer match the originals.
2. Store the rounded line amounts. Matches everywhere, but needs a migration.

**Questions for you**
1. Is it fine if reprinted old invoices differ by a few cents?
2. Can we run a migration this sprint?`;

const continueAsk = (handle: string) =>
  ({
    type: 'tool_call',
    tool: 'ask',
    handle,
    input: { kind: 'choice', question: 'Ready for the fixes?', options: [{ label: 'Continue' }] },
  }) as const;

/** Drive walkthrough example: two segments, the worker's questions as asks, then one forward. */
const driveExample = (pause: 'ask' | 'natural'): Example =>
  [
    { type: 'user_message', text: 'Why are the invoice totals off by a few cents?' },
    { type: 'tool_call', tool: 'forward', handle: 'call_1', input: {} },
    { type: 'speak', text: 'Let me look into that.' },
    {
      type: 'tool_result',
      tool: 'forward',
      handle: 'call_1',
      result: { messages: [invoiceReply] },
    },
    { type: 'speak', text: "Found it. It's rounding." },
    {
      type: 'tool_call',
      tool: 'show',
      handle: 'call_2',
      input: {
        title: 'Why totals drift',
        format: 'mermaid',
        content:
          'flowchart LR\n  L[Line items] --> E[PDF export: rounds tax per line]\n  L --> D[Database: rounds once per invoice]\n  E --> X{Totals differ by a few cents}\n  D --> X',
      },
    },
    {
      type: 'speak',
      text: 'The export and the database round tax at different points, so their totals end up a few cents apart.',
    },
    ...(pause === 'ask'
      ? [
          continueAsk('call_3'),
          {
            type: 'tool_result',
            tool: 'ask',
            handle: 'call_3',
            result: {
              question: 'Ready for the fixes?',
              answer: { kind: 'choice', choice: 'Continue' },
            },
          },
        ]
      : [{ type: 'user_message', text: 'Continue.' }]),
    { type: 'speak', text: 'I see two ways to fix it.' },
    {
      type: 'tool_call',
      tool: 'show',
      handle: 'call_4',
      input: {
        title: 'Two fixes',
        format: 'markdown',
        content:
          '| Fix | Cost | Catch |\n|---|---|---|\n| Round once in the export | Small change | Old invoices reprint differently |\n| Store rounded line amounts | A migration | None: matches everywhere |',
      },
    },
    {
      type: 'speak',
      text: 'The quick one breaks old reprints; the migration keeps everything matching. Two questions decide it.',
    },
    {
      type: 'tool_call',
      tool: 'ask',
      handle: 'call_5',
      input: {
        kind: 'choice',
        question: 'Is it fine if reprinted old invoices differ by a few cents?',
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    },
    {
      type: 'tool_call',
      tool: 'ask',
      handle: 'call_6',
      input: {
        kind: 'choice',
        question: 'Can we run a migration this sprint?',
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    },
    {
      type: 'tool_result',
      tool: 'ask',
      handle: 'call_5',
      result: {
        question: 'Is it fine if reprinted old invoices differ by a few cents?',
        answer: { kind: 'choice', choice: 'Yes' },
      },
    },
    {
      type: 'tool_result',
      tool: 'ask',
      handle: 'call_6',
      result: {
        question: 'Can we run a migration this sprint?',
        answer: { kind: 'choice', choice: 'No', text: 'not before the release' },
      },
    },
    { type: 'tool_call', tool: 'forward', handle: 'call_7', input: {} },
    { type: 'speak', text: 'Got it, one moment.' },
  ] as unknown as Example;

const routingExamples: Array<Example> = [
  [
    { type: 'user_message', text: 'Hey, are you there?' },
    { type: 'speak', text: "Hey, I'm here. What are we working on?" },
  ],
  [
    continueAsk('call_1'),
    {
      type: 'tool_result',
      tool: 'ask',
      handle: 'call_1',
      result: {
        question: 'Ready for the fixes?',
        answer: {
          kind: 'text',
          text: 'Wait, why not just fix the database instead?',
          interrupted: true,
        },
      },
    },
    { type: 'tool_call', tool: 'forward', handle: 'call_2', input: {} },
    { type: 'speak', text: 'Good question, let me check.' },
  ],
  [
    { type: 'user_message', text: 'So the retries survive a restart, right?' },
    { type: 'tool_call', tool: 'forward', handle: 'call_1', input: {} },
    { type: 'speak', text: 'Let me check.' },
  ],
] as unknown as Array<Example>;

const style = `## Speaking
- Speech orients; the screen carries the material. One or two short sentences before each \`show\`: why it matters and what to look at. Never read the screen out.
- Sound like a person talking: plain words, contractions, varied rhythm, the occasional "so" or "here's the thing". No markdown, code, file paths or URLs in speech.
- Keep the first speak short, so the listener hears you right away.`;

const driveRole = (pause: 'ask' | 'natural') => `## Role
You are the voice of an assistant. The listener talks to you as if you were the assistant: every \`speak\` is spoken aloud, and every \`show\` appears on their screen. Speak as the assistant, in the first person: the work in a \`forward\` result is yours ("I looked at…", "I'd go with…"). Never mention forwarding, a worker or anyone else doing the work.

You do not think, answer or decide anything yourself: all of that happens in your work, which \`forward\` starts and a \`forward\` result brings back. You have two jobs.

1. Walk the listener through each \`forward\` result, one segment at a time.
2. Forward everything the listener says, except greetings and small talk.

## Walking through a forward result
- Split the result into segments in its order: one idea, step or section each. A short result can be one segment; a long one may need five or more.
- Each response presents exactly one segment, then stops. The listener continues when ready.
- A segment is one to three compact \`show\`s, each after a sentence or two of speech.
- Shows compress: short bullets, a small table for options or comparisons, a mermaid diagram for flows and structures. Keep every decision, reason, risk, number, option and recommendation; drop only wording. Add nothing of your own.
- Text meant to be used exactly as written (a command, code, config) is shown verbatim.
${
  pause === 'ask'
    ? '- End every segment with an `ask`: the result\'s questions that belong to this segment, one `ask` each with its options; otherwise one `ask` with `kind: "choice"`, a short question such as "Ready for the next part?" and the single option "Continue".'
    : '- End every segment by simply stopping, or with the result\'s questions that belong to it, one `ask` each with its options. The listener says "Continue" when ready.'
}
- Keep the listener's answers: don't respond to them or forward them yet; go on to the next segment.
- After the last segment and its questions, write \`forward\`: it hands your work all the answers at once.

## Forwarding
- Forward when the listener interrupts, or says anything that is not an answer, "Continue" or small talk: requests, questions, pushback, "slow down", "say that again". Write \`forward\` first, then one short line that buys time, and stop. You don't know anything a \`forward\` result didn't tell you, so never answer, agree or confirm on your own.`;

const driveSystem =
  (pause: 'ask' | 'natural', withExamples: boolean) =>
  (_tools: ReadonlyArray<ToolDefinition>, parts: PromptParts) =>
    [
      driveRole(pause),
      parts.speakersBlock,
      style,
      `## Tool rules\n${parts.toolRules}`,
      `<instructions>\n${prod.instructions.trim()}\n</instructions>`,
      `## Output format\n\`\`\`ts\n${parts.outputType}\n\`\`\`\nRespond with only a JSON array of \`Action\`. No prose outside it. Never write a \`call\` field.`,
      `## Examples (listener input, then your response)\n${parts.examples([...(withExamples ? [driveExample(pause)] : []), ...routingExamples])}`,
    ].join('\n\n');

/** Short tool guidelines: mechanics only; the walkthrough rules live in the role. */
const driveTools = {
  show: [
    'Use `show` to put material on screen: `markdown` for text, lists and tables; `mermaid` for diagrams (only the Mermaid source, no code fence). Each `show` replaces the previous one.',
  ],
  ask: [
    "Use `ask` for one question that needs the listener's answer. `ask` blocks: the conversation waits for the answer, which arrives as a `<tool_result>`. The listener can always answer in their own words.",
  ],
  forward: [
    '`forward` (just `{"type":"forward"}`, no fields) hands your work the conversation since the last `forward`, including the listener\'s answers.',
  ],
};

const d1Text: DriveReminderText = {
  reply: 'Present only the first segment of this result now, then stop with an `ask`.',
  continue:
    'Present the next segment only, the one right after what you last showed, then stop with an `ask`. If everything is presented and every question asked, write `forward` instead.',
  answer:
    "Answer kept. Don't respond to it or forward it yet: present the next segment, then stop with an `ask`. If everything is presented and every question asked, write `forward` now.",
  interrupt: 'The listener interrupted: write `forward` first, then one short line that buys time.',
  message:
    'Forward this first unless it is small talk; you know only what `forward` results told you.',
};

const d1NatText: DriveReminderText = {
  ...d1Text,
  reply: 'Present only the first segment of this result now, then stop.',
  continue:
    'Present the next segment only, the one right after what you last showed, then stop. If everything is presented and every question asked, write `forward` instead.',
  answer:
    "Answer kept. Don't respond to it or forward it yet: present the next segment, then stop. If everything is presented and every question asked, write `forward` now.",
};

export const d1Ask: Variant = {
  id: 'd1-ask',
  notes:
    'Drive role + short tool lines + drive example + per-event reminders; pause = Continue ask.',
  tools: driveTools,
  system: driveSystem('ask', true),
  examples: [],
  reminders: driveReminders(d1Text),
  pause: 'ask',
};

export const d1Nat: Variant = {
  id: 'd1-nat',
  notes: 'As d1-ask, but a segment ends by stopping; the listener sends "Continue." as a message.',
  tools: driveTools,
  system: driveSystem('natural', true),
  examples: [],
  reminders: driveReminders(d1NatText, { natural: true }),
  pause: 'natural',
};

export const d1AskNoEx: Variant = {
  ...d1Ask,
  id: 'd1-ask-noex',
  notes: 'd1-ask without the walkthrough example (routing examples kept).',
  system: driveSystem('ask', false),
};

export const d1AskNoRem: Variant = {
  ...d1Ask,
  id: 'd1-ask-norem',
  notes: 'd1-ask with only the interrupt reminder.',
  reminders: driveReminders({ ...d1Text, reply: '', continue: '', answer: '', message: '' }),
};

/** Building blocks generated variants can reuse. */
export const blocks = {
  prodFlow,
  d1Ask,
  d1Nat,
  d1Text,
  d1NatText,
  driveRole,
  driveSystem,
  driveTools,
  driveExample,
  routingExamples,
  continueAsk,
  style,
  invoiceReply,
};
