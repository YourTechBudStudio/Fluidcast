import type { Prompt } from 'effect/unstable/ai';

import { isModelAuthored, type Action, type Speak } from '../actions/index.ts';

export const interruptedNotice = 'You were interrupted during your last line.';
export const cutOffNotice =
  'Your previous response was cut off after the last line. Continue from there.';
export const failedBeforeLinesNotice =
  'Your previous response failed before any lines were delivered. Respond again.';

type Run =
  | { readonly role: 'assistant'; readonly items: Array<Omit<Speak, 'id'>> }
  | { readonly role: 'user'; readonly items: Array<string> };

/**
 * Renders the history (the actions up to the cursor) as native chat messages. Each run of
 * model-authored actions becomes one assistant message holding their JSON array; each run of other
 * actions becomes one user message of XML envelopes, with user text entity-encoded. Action IDs
 * never reach the model.
 */
export const renderHistory = (
  history: ReadonlyArray<Action>,
): Array<Prompt.UserMessageEncoded | Prompt.AssistantMessageEncoded> => {
  const runs: Array<Run> = [];
  history.forEach((action, index) => {
    const last = runs.at(-1);
    if (isModelAuthored(action)) {
      const { id: _id, ...content } = action;
      if (last?.role === 'assistant') last.items.push(content);
      else runs.push({ role: 'assistant', items: [content] });
    } else {
      const item = envelope(action, history[index - 1]);
      if (last?.role === 'user') last.items.push(item);
      else runs.push({ role: 'user', items: [item] });
    }
  });
  return runs.map((run) =>
    run.role === 'assistant'
      ? { role: 'assistant', content: JSON.stringify(run.items) }
      : { role: 'user', content: run.items.join('\n') },
  );
};

const envelope = (action: Exclude<Action, Speak>, previous: Action | undefined): string => {
  switch (action.type) {
    case 'user_message':
      return `<user_message>${escapeXml(action.text)}</user_message>`;
    case 'interrupted':
      return `<notice>${interruptedNotice}</notice>`;
    case 'generation_failed':
      return `<notice>${previous !== undefined && isModelAuthored(previous) ? cutOffNotice : failedBeforeLinesNotice}</notice>`;
  }
};

/** Encodes markup characters so user text cannot close its envelope or forge a `<notice>`. */
const escapeXml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
