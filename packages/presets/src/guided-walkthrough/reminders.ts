import type { ReminderEvent } from '@yourtechbudstudio/fluidcast-core/generation';
import { forwardToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import { type AskResult, askToolName } from '@yourtechbudstudio/fluidcast-tool-ask/schema';

/** The evaluated reminder texts, verbatim: rewording makes them untested. */
export const reminderTexts = {
  reply: 'Present only the first segment of this result now, then stop with an `ask`.',
  continue:
    'Present the next segment only, the one right after what you last showed, then stop with an `ask`. If everything is presented and every question asked, write `forward_agent` instead.',
  answer:
    "Answer kept for your work, which judges it. Don't confirm, correct or explain it, and don't forward it yet: present the result's next segment, then stop with an `ask`. If the result is all presented and every question asked, write `forward_agent` now.",
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
  return answer.kind === 'continue' ? reminderTexts.continue : reminderTexts.answer;
};
