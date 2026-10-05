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

/** An answer that asks for the next segment, chosen or typed. */
const continuePattern = /^\s*(continue|next|go on|keep going)\b/i;

/**
 * Whether an answer is a Continue, as the evaluation judged it: a chosen label or a typed answer
 * that matches. Text typed beside a choice, and any multi answer, never count.
 */
const isContinue = (answer: AskResult['answer']): boolean => {
  switch (answer.kind) {
    case 'choice':
      return continuePattern.test(answer.choice);
    case 'text':
      return continuePattern.test(answer.text);
    case 'multi':
      return false;
  }
};

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
  return isContinue(answer) ? reminderTexts.continue : reminderTexts.answer;
};
