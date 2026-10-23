import type { ReminderEvent } from '@yourtechbudstudio/fluidcast-core/generation';
import { forwardToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import { askNote, type AskResult, askToolName } from '@yourtechbudstudio/fluidcast-tool-ask/schema';

/**
 * Without it, the voice put a result's questions on a screen and moved on with a checkpoint, so
 * the listener could not answer them. Measured on Qwen and Claude in October 2026, in the reply,
 * continue and answer reminders; dropping it from `answer` brought back a catch-all ask.
 */
const askEachQuestion =
  "Never put the result's questions on a screen: ask each one in its own `text` ask, with the setup it needs, where it comes up.";

/**
 * The evaluated reminder texts, verbatim: rewording makes them untested. `askEachQuestion` was
 * evaluated as an addition after the first sentence that ends in "stop with an `ask`.".
 */
export const reminderTexts = {
  reply: `Present only the first segment of this result now, then stop with an \`ask\`. ${askEachQuestion}`,
  continue: `Present the next segment only, the one right after what you last showed, then stop with an \`ask\`. ${askEachQuestion} If everything is presented and every question asked, write \`forward_agent\` instead.`,
  answer: `Answer kept for your work, which judges it. Don't confirm, correct or explain it, and don't forward it yet: present the result's next segment, then stop with an \`ask\`. ${askEachQuestion} If the result is all presented and every question asked, write \`forward_agent\` now.`,
  interrupt:
    'The listener interrupted: write `forward_agent` first, then one short line that buys time.',
  message:
    'Forward this first unless it is small talk; you know only what `forward_agent` results told you.',
} as const;

/**
 * The Guided Walkthrough's reminder for the newest input: a pure function of the event, recognising
 * tools by name. Results of any other tool get none.
 */
export const reminders = (event: ReminderEvent): string | undefined => {
  if (event._tag === 'UserMessage') {
    return event.interrupted ? reminderTexts.interrupt : reminderTexts.message;
  }
  if (event.tool === forwardToolName) return reminderTexts.reply;
  if (event.tool !== askToolName) return undefined;
  // Core decoded it with the Ask tool's `result` schema.
  const { answer } = event.result as AskResult;
  // A Continue with a note gets `answer`: on `continue`, the voice responded to notes and forwarded
  // early (measured on Sonnet in October 2026).
  return answer.kind === 'continue' && askNote(answer) === undefined
    ? reminderTexts.continue
    : reminderTexts.answer;
};
