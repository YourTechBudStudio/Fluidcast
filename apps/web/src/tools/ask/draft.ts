import type { AskCommand, AskInput } from '@yourtechbudstudio/fluidcast-tool-ask/schema';

/** What the listener has put together so far: typed text and, for `multi`, the options toggled on (by index). */
export interface AskDraft {
  readonly text: string;
  readonly picked: readonly number[];
}

/** The options a question offers: only `choice` and `multi` have any. */
export const optionsOf = (input: AskInput) =>
  input.kind === 'choice' || input.kind === 'multi' ? input.options : [];

const withText = (text: string) => {
  const trimmed = text.trim();
  return trimmed ? { text: trimmed } : {};
};

/**
 * The answer pressing option `index` gives: a `choice` question answers at once, carrying any typed text. `multi`
 * toggles instead, so it has no answer here.
 */
export function answerForOption(
  input: AskInput,
  draft: AskDraft,
  index: number,
): AskCommand | undefined {
  const option = optionsOf(input)[index];
  if (input.kind !== 'choice' || !option) return undefined;
  return { kind: 'choice', choice: option.label, ...withText(draft.text) };
}

/** Toggles option `index` of a `multi` question, keeping the picks in offered order. */
export function toggled(draft: AskDraft, index: number): AskDraft {
  const picked = draft.picked.includes(index)
    ? draft.picked.filter((i) => i !== index)
    : [...draft.picked, index].sort((a, b) => a - b);
  return { ...draft, picked };
}

/**
 * The answer the Send button gives: the `multi` picks with any typed text, or else the typed text alone as a `text`
 * answer. `undefined` when there is nothing to send, and always for `continue`, which has no Send.
 */
export function answerForSend(input: AskInput, draft: AskDraft): AskCommand | undefined {
  if (input.kind === 'continue') return undefined;
  const options = optionsOf(input);
  if (input.kind === 'multi' && draft.picked.length > 0) {
    return {
      kind: 'multi',
      choices: draft.picked.map((i) => options[i]!.label),
      ...withText(draft.text),
    };
  }
  const text = draft.text.trim();
  return text ? { kind: 'text', text } : undefined;
}

/** The labels an answer chose, if any: a `continue` answer chose Continue. */
export const chosenOf = (answer: AskCommand | null | undefined): readonly string[] => {
  switch (answer?.kind) {
    case 'choice':
      return [answer.choice];
    case 'multi':
      return answer.choices;
    case 'continue':
      return ['Continue'];
    default:
      return [];
  }
};

/** Any free text the listener typed with an answer. A `continue` answer has none. */
export const typedOf = (answer: AskCommand | null | undefined): string | undefined =>
  answer && answer.kind !== 'continue' ? answer.text : undefined;
