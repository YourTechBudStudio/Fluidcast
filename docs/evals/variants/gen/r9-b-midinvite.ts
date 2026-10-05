import type { ToolDefinition } from '../../../../packages/core/src/generation/tools.ts';
import type { Variant } from '../../lib/drive.ts';
import type { Example, PromptParts } from '../../lib/prompt.ts';
// Round 9, candidate B (small, targeted at the champion's most frequent question loss; precedent only): r8-b-proseprecedent + bare option labels (= r9-x-nodesc), but one prose paragraph of the walkthrough report ends with a question-mark-free invitation ('push back if…'), and the precedent asks it as a choice in that paragraph's segment in place of the Continue.
import { blocks, d1AskNoEx } from '../blocks.ts';
import { driveReminders, prod } from '../common.ts';

const interimNote = `The run logs are still loading. Here's what I've confirmed so far.

- Six jobs run every night, 95 minutes in total.
- The longest is the search reindex, at 50 minutes.

One question while I wait: does anyone outside our team rely on the report emails?`;

const auditReply = `The logs are back. Done: I audited the six nightly jobs. Nothing is changed yet.

**Three can go.** The thumbnail rebuild is redundant, because thumbnails are built on upload now. The stale session sweep does nothing useful any more: sessions expire on their own after a day. The temp file cleanup still targets the folder we removed last month, so all it does is log an error every night. I'd archive its script rather than delete it; push back if you'd rather it's gone for good. Dropping all three saves about 40 minutes a night.

**One can shrink.** The report job sends three emails where one would do. Merging them is simple, but finance filters on the old subject lines, so they'd need a heads-up before we switch.

**Two stay.** The search reindex is still our only full reindex, and the backup copy is what every restore depends on.

Should I drop the three now, or after the release? My question about the report emails still stands.

Next, I'll merge the report emails into one.`;

const question = 'Should I drop the three jobs now, or after the release?';
const early = 'Does anyone outside our team rely on the report emails?';
const invitation = 'Archive the temp cleanup script, or delete it for good?';

/** The champion's walkthrough, but the report is headed prose, not a table: each paragraph's sentences become one short line per point in the voice's own words (the fact, then its reason, caveat or effect after an arrow), no point and no reason dropped, and the prose report takes two segments (what can go; then what shrinks and stays, with the choice question). */
const walkthrough = [
  { type: 'user_message', text: 'Can you check which nightly jobs we still need?' },
  { type: 'tool_call', tool: 'forward', handle: 'call_1', input: {} },
  { type: 'speak', text: 'Sure, let me check.' },
  {
    type: 'tool_result',
    tool: 'forward',
    handle: 'call_1',
    result: { messages: [interimNote, auditReply] },
  },
  { type: 'speak', text: 'While the logs loaded, I confirmed the basics.' },
  {
    type: 'tool_call',
    tool: 'show',
    handle: 'call_2',
    input: {
      title: 'So far',
      format: 'markdown',
      content: '**6 jobs** a night · **95 min** in total\n\nLongest: search reindex, **50 min**',
    },
  },
  {
    type: 'tool_call',
    tool: 'ask',
    handle: 'call_3',
    input: { kind: 'choice', question: early, options: [{ label: 'Yes' }, { label: 'No' }] },
  },
  {
    type: 'tool_result',
    tool: 'ask',
    handle: 'call_3',
    result: { question: early, answer: { kind: 'choice', choice: 'No' } },
  },
  {
    type: 'speak',
    text: "The logs are back. I audited all six jobs, and nothing's changed yet. Three of them can go.",
  },
  {
    type: 'tool_call',
    tool: 'show',
    handle: 'call_4',
    input: {
      title: 'Three can go',
      format: 'markdown',
      content:
        "- **Thumbnail rebuild** → redundant: thumbnails are built on upload now\n- **Session sweep** → useless: sessions expire on their own after a day\n- **Temp cleanup** → its folder was removed last month; it only logs an error nightly → I'd archive its script, not delete it\n\nDropping all three saves **~40 min a night**.",
    },
  },
  {
    type: 'tool_call',
    tool: 'ask',
    handle: 'call_5',
    input: {
      kind: 'choice',
      question: invitation,
      options: [{ label: 'Archive it' }, { label: 'Delete it' }],
    },
  },
  {
    type: 'tool_result',
    tool: 'ask',
    handle: 'call_5',
    result: { question: invitation, answer: { kind: 'choice', choice: 'Archive it' } },
  },
  {
    type: 'speak',
    text: 'Okay. Of the other three, one can shrink, with one catch, and two stay.',
  },
  {
    type: 'tool_call',
    tool: 'show',
    handle: 'call_6',
    input: {
      title: 'Shrink one, keep two',
      format: 'markdown',
      content:
        '**Shrink**\n- **Report emails** → 3 a night where 1 would do; merging is simple\n- Catch: finance filters on the old subject lines → heads-up before we switch\n\n**Keep**\n- **Search reindex** → still the only full reindex\n- **Backup copy** → every restore depends on it',
    },
  },
  {
    type: 'tool_call',
    tool: 'ask',
    handle: 'call_7',
    input: {
      kind: 'choice',
      question,
      options: [{ label: 'Now' }, { label: 'After the release' }],
    },
  },
  {
    type: 'tool_result',
    tool: 'ask',
    handle: 'call_7',
    result: { question, answer: { kind: 'text', text: 'Whatever you think is best.' } },
  },
  { type: 'speak', text: "Okay. One last thing: what's next." },
  {
    type: 'tool_call',
    tool: 'show',
    handle: 'call_8',
    input: {
      title: 'Next',
      format: 'markdown',
      content: 'Merge the three report emails into one.',
    },
  },
  {
    type: 'tool_call',
    tool: 'ask',
    handle: 'call_9',
    input: {
      kind: 'choice',
      question: 'Ready to send your answer?',
      options: [{ label: 'Continue' }],
    },
  },
  {
    type: 'tool_result',
    tool: 'ask',
    handle: 'call_9',
    result: {
      question: 'Ready to send your answer?',
      answer: { kind: 'choice', choice: 'Continue' },
    },
  },
  { type: 'tool_call', tool: 'forward', handle: 'call_10', input: {} },
  { type: 'speak', text: 'One moment.' },
] as unknown as Example;

const checkReply = `Here's how the nightly backup is chained.

- The backup starts only after the search reindex finishes.
- The reindex has no time limit.
- A backup that hasn't started by 6 am is skipped until the next night.

Quick check before I go on: if the reindex hangs one night, what happens to that night's backup?`;

const check = "If the reindex hangs one night, what happens to that night's backup?";

/** A worker check question: the screen keeps the facts and stops short of the inference, the question is asked in the worker's words, and the listener's confident, correct answer gets no grade, no explanation and no reaction: the next response is the forward. */
const checkExample = [
  { type: 'user_message', text: 'How does the nightly backup work?' },
  { type: 'tool_call', tool: 'forward', handle: 'call_1', input: {} },
  { type: 'speak', text: 'Let me check.' },
  { type: 'tool_result', tool: 'forward', handle: 'call_1', result: { messages: [checkReply] } },
  { type: 'speak', text: "The backup hangs off the reindex. Here's the chain." },
  {
    type: 'tool_call',
    tool: 'show',
    handle: 'call_2',
    input: {
      title: 'Backup chain',
      format: 'markdown',
      content:
        'Reindex finishes → backup starts\n\nReindex: **no time limit**\n\nNot started by **6 am** → skipped until the next night',
    },
  },
  { type: 'tool_call', tool: 'ask', handle: 'call_3', input: { kind: 'text', question: check } },
  {
    type: 'tool_result',
    tool: 'ask',
    handle: 'call_3',
    result: {
      question: check,
      answer: { kind: 'text', text: "It never starts, so it's skipped until the next night." },
    },
  },
  { type: 'tool_call', tool: 'forward', handle: 'call_4', input: {} },
  { type: 'speak', text: 'One moment.' },
] as unknown as Example;

const system = (_tools: ReadonlyArray<ToolDefinition>, parts: PromptParts) =>
  [
    blocks.driveRole('ask'),
    parts.speakersBlock,
    blocks.style,
    `## Tool rules\n${parts.toolRules}`,
    `<instructions>\n${prod.instructions.trim()}\n</instructions>`,
    `## Output format\n\`\`\`ts\n${parts.outputType}\n\`\`\`\nRespond with only a JSON array of \`Action\`. No prose outside it. Never write a \`call\` field.`,
    `## Examples (listener input, then your response)\n${parts.examples([walkthrough, checkExample, ...blocks.routingExamples])}`,
  ].join('\n\n');

const variant: Variant = {
  ...d1AskNoEx,
  id: 'r9-b-midinvite',
  tools: { ...d1AskNoEx.tools, askOptionDescriptions: false },
  notes:
    'Final champion of the 2026-10 hill-climb (rounds 0–9). Walkthrough example: an interim note then a prose report (per-point arrow lines, an inline invitation asked as a choice, a deferral answered with a plain Okay); a check-question example whose correct answer gets no grade; routing examples; per-event reminders; ask options are bare labels. Lineage and evidence: docs/research/guided-walkthrough-prompting.md.',
  system,
  reminders: driveReminders({
    ...blocks.d1Text,
    answer:
      "Answer kept for your work, which judges it. Don't confirm, correct or explain it, and don't forward it yet: present the result's next segment, then stop with an `ask`. If the result is all presented and every question asked, write `forward` now.",
  }),
};
export default variant;
