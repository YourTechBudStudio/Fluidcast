/** Shared pieces for variants: the production experience, and drive-mode building blocks. */
import { readFileSync } from 'node:fs';

import type { DriveState, Variant } from '../lib/drive.ts';
import type { Example, Reminders } from '../lib/prompt.ts';

export const prod = JSON.parse(
  readFileSync(new URL('./prod-experience.json', import.meta.url), 'utf8'),
) as {
  instructions: string;
  examples: Array<Example>;
  reminders: {
    userMessage: string;
    userMessageAfterInterrupt: string;
    toolResult: { ask: string };
  };
};

/** Production reminders, as the backend maps them (absent keys keep tool defaults). */
export const prodReminders: Reminders = (event) => {
  if (event._tag === 'UserMessage') {
    return event.interrupted
      ? prod.reminders.userMessageAfterInterrupt
      : prod.reminders.userMessage;
  }
  if (event.tool === 'ask') {
    const interrupted = (event.result as { answer: { interrupted?: boolean } }).answer.interrupted;
    return interrupted === true ? event.defaultReminder : prod.reminders.toolResult.ask;
  }
  return event.defaultReminder;
};

const isInterruptedAnswer = (result: unknown) =>
  (result as { answer?: { interrupted?: boolean } }).answer?.interrupted === true;

const isContinueAnswer = (result: unknown) => {
  const answer = (result as { answer?: { kind: string; choice?: string; text?: string } }).answer;
  const value = answer?.kind === 'choice' ? answer.choice : answer?.text;
  return /^\s*(continue|next|go on|keep going)\b/i.test(value ?? '');
};

/**
 * Drive reminders by event. Stateless in the harness's sense: each is a pure function of the
 * newest input (a forward result, a Continue, an answer, an interrupt, or a new message).
 */
export type DriveReminderText = {
  reply: string;
  continue: string;
  answer: string;
  interrupt: string;
  message: string;
};

export const driveReminders =
  (text: DriveReminderText, options: { natural?: boolean } = {}) =>
  (_state: DriveState): Reminders =>
  (event) => {
    if (event._tag === 'UserMessage') {
      if (event.interrupted) return text.interrupt;
      if (options.natural === true && /^\s*(continue|next|go on)\b/i.test(event.text)) {
        return text.continue;
      }
      return text.message;
    }
    if (event.tool === 'forward' || event.tool === 'forward_agent') return text.reply;
    if (event.tool === 'ask') {
      if (isInterruptedAnswer(event.result)) return text.interrupt;
      return isContinueAnswer(event.result) ? text.continue : text.answer;
    }
    return event.defaultReminder;
  };

export type { Variant };
