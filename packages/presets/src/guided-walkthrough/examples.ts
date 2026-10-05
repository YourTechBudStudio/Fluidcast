import type { Example, ExampleStep } from '@yourtechbudstudio/fluidcast-core/generation';
import {
  type ForwardResult,
  forwardToolName,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import type { AskCommand } from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import { askToolName } from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import { showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

/*
 * The Guided Walkthrough's worked examples, reconstructed from the evaluated prompt: rendered by
 * Core, they reproduce its Examples section byte for byte, except the interrupted question, which
 * shows an interrupt cancelling the question rather than the evaluated interrupted answer. Handles
 * number each example's tool calls in order, so results name the call they answer.
 */

const user = (text: string): ExampleStep => ({ type: 'user_message', text });
const say = (text: string): ExampleStep => ({ type: 'speak', text });
const forward = (handle: string): ExampleStep => ({
  type: 'tool_call',
  tool: forwardToolName,
  handle,
  input: {},
});
const replied = (handle: string, messages: ForwardResult['messages']): ExampleStep => ({
  type: 'tool_result',
  tool: forwardToolName,
  handle,
  result: { messages: [...messages] },
});
const show = (handle: string, title: string, content: string): ExampleStep => ({
  type: 'tool_call',
  tool: showToolName,
  handle,
  input: { title, format: 'markdown', content },
});
const choice = (handle: string, question: string, labels: ReadonlyArray<string>): ExampleStep => ({
  type: 'tool_call',
  tool: askToolName,
  handle,
  input: { kind: 'choice', question, options: labels.map((label) => ({ label })) },
});
const question = (handle: string, text: string): ExampleStep => ({
  type: 'tool_call',
  tool: askToolName,
  handle,
  input: { kind: 'text', question: text },
});
const answered = (handle: string, text: string, answer: AskCommand): ExampleStep => ({
  type: 'tool_result',
  tool: askToolName,
  handle,
  result: { question: text, answer },
});

/** A long forward result walked through one segment at a time, its questions asked along the way, then forwarded. */
const nightlyJobs: Example = [
  user('Can you check which nightly jobs we still need?'),
  forward('call_1'),
  say('Sure, let me check.'),
  replied('call_1', [
    "The run logs are still loading. Here's what I've confirmed so far.\n\n- Six jobs run every night, 95 minutes in total.\n- The longest is the search reindex, at 50 minutes.\n\nOne question while I wait: does anyone outside our team rely on the report emails?",
    "The logs are back. Done: I audited the six nightly jobs. Nothing is changed yet.\n\n**Three can go.** The thumbnail rebuild is redundant, because thumbnails are built on upload now. The stale session sweep does nothing useful any more: sessions expire on their own after a day. The temp file cleanup still targets the folder we removed last month, so all it does is log an error every night. I'd archive its script rather than delete it; push back if you'd rather it's gone for good. Dropping all three saves about 40 minutes a night.\n\n**One can shrink.** The report job sends three emails where one would do. Merging them is simple, but finance filters on the old subject lines, so they'd need a heads-up before we switch.\n\n**Two stay.** The search reindex is still our only full reindex, and the backup copy is what every restore depends on.\n\nShould I drop the three now, or after the release? My question about the report emails still stands.\n\nNext, I'll merge the report emails into one.",
  ]),
  say('While the logs loaded, I confirmed the basics.'),
  show(
    'call_2',
    'So far',
    '**6 jobs** a night · **95 min** in total\n\nLongest: search reindex, **50 min**',
  ),
  choice('call_3', 'Does anyone outside our team rely on the report emails?', ['Yes', 'No']),
  answered('call_3', 'Does anyone outside our team rely on the report emails?', {
    kind: 'choice',
    choice: 'No',
  }),
  say(
    "The logs are back. I audited all six jobs, and nothing's changed yet. Three of them can go.",
  ),
  show(
    'call_4',
    'Three can go',
    "- **Thumbnail rebuild** → redundant: thumbnails are built on upload now\n- **Session sweep** → useless: sessions expire on their own after a day\n- **Temp cleanup** → its folder was removed last month; it only logs an error nightly → I'd archive its script, not delete it\n\nDropping all three saves **~40 min a night**.",
  ),
  choice('call_5', 'Archive the temp cleanup script, or delete it for good?', [
    'Archive it',
    'Delete it',
  ]),
  answered('call_5', 'Archive the temp cleanup script, or delete it for good?', {
    kind: 'choice',
    choice: 'Archive it',
  }),
  say('Okay. Of the other three, one can shrink, with one catch, and two stay.'),
  show(
    'call_6',
    'Shrink one, keep two',
    '**Shrink**\n- **Report emails** → 3 a night where 1 would do; merging is simple\n- Catch: finance filters on the old subject lines → heads-up before we switch\n\n**Keep**\n- **Search reindex** → still the only full reindex\n- **Backup copy** → every restore depends on it',
  ),
  choice('call_7', 'Should I drop the three jobs now, or after the release?', [
    'Now',
    'After the release',
  ]),
  answered('call_7', 'Should I drop the three jobs now, or after the release?', {
    kind: 'text',
    text: 'Whatever you think is best.',
  }),
  say("Okay. One last thing: what's next."),
  show('call_8', 'Next', 'Merge the three report emails into one.'),
  choice('call_9', 'Ready to send your answer?', ['Continue']),
  answered('call_9', 'Ready to send your answer?', { kind: 'choice', choice: 'Continue' }),
  forward('call_10'),
  say('One moment.'),
];

/** A short forward result with a question that checks understanding. */
const nightlyBackup: Example = [
  user('How does the nightly backup work?'),
  forward('call_1'),
  say('Let me check.'),
  replied('call_1', [
    "Here's how the nightly backup is chained.\n\n- The backup starts only after the search reindex finishes.\n- The reindex has no time limit.\n- A backup that hasn't started by 6 am is skipped until the next night.\n\nQuick check before I go on: if the reindex hangs one night, what happens to that night's backup?",
  ]),
  say("The backup hangs off the reindex. Here's the chain."),
  show(
    'call_2',
    'Backup chain',
    'Reindex finishes → backup starts\n\nReindex: **no time limit**\n\nNot started by **6 am** → skipped until the next night',
  ),
  question('call_3', "If the reindex hangs one night, what happens to that night's backup?"),
  answered('call_3', "If the reindex hangs one night, what happens to that night's backup?", {
    kind: 'text',
    text: "It never starts, so it's skipped until the next night.",
  }),
  forward('call_4'),
  say('One moment.'),
];

/** Small talk is answered, not forwarded. */
const greeting: Example = [
  user('Hey, are you there?'),
  say("Hey, I'm here. What are we working on?"),
];

/** A question the listener declines by interrupting: what they say instead is forwarded at once. */
const interruptedQuestion: Example = [
  choice('call_1', 'Ready for the fixes?', ['Continue']),
  { type: 'interrupted', during: 'wait' },
  user('Wait, why not just fix the database instead?'),
  forward('call_2'),
  say('Good question, let me check.'),
];

/** A plain question is forwarded, never answered. */
const plainQuestion: Example = [
  user('So the retries survive a restart, right?'),
  forward('call_1'),
  say('Let me check.'),
];

/** The detailed profile's examples, in the evaluated order. */
export const examples: ReadonlyArray<Example> = [
  nightlyJobs,
  nightlyBackup,
  greeting,
  interruptedQuestion,
  plainQuestion,
];
