import { describe, expect, it } from 'vitest';

import type { AskInput } from '@yourtechbudstudio/fluidcast-tool-ask/schema';

import { answerForOption, answerForSend, chosenOf, toggled } from './draft';

const options = [{ label: 'Client' }, { label: 'Server' }, { label: 'Both' }];
const choice: AskInput = { kind: 'choice', question: 'Who?', options };
const multi: AskInput = { kind: 'multi', question: 'Which?', options };
const text: AskInput = { kind: 'text', question: 'Why?' };

describe('the Ask draft', () => {
  it('answers a choice on press, carrying any typed text', () => {
    expect(answerForOption(choice, { text: '  mostly ', picked: [] }, 1)).toEqual({
      kind: 'choice',
      choice: 'Server',
      text: 'mostly',
    });
    expect(answerForOption(choice, { text: ' ', picked: [] }, 0)).toEqual({
      kind: 'choice',
      choice: 'Client',
    });
    expect(answerForOption(multi, { text: '', picked: [] }, 0)).toBeUndefined();
  });

  it('toggles multi picks in offered order, then sends them with any typed text', () => {
    const draft = toggled(toggled(toggled({ text: 'and more', picked: [] }, 2), 0), 1);
    expect(draft.picked).toEqual([0, 1, 2]);
    expect(toggled(draft, 1).picked).toEqual([0, 2]);
    expect(answerForSend(multi, toggled(draft, 1))).toEqual({
      kind: 'multi',
      choices: ['Client', 'Both'],
      text: 'and more',
    });
  });

  it('sends typed text alone as a text answer, and nothing when empty', () => {
    expect(answerForSend(choice, { text: ' A server ', picked: [] })).toEqual({
      kind: 'text',
      text: 'A server',
    });
    expect(answerForSend(text, { text: '   ', picked: [] })).toBeUndefined();
    expect(answerForSend(multi, { text: 'Neither', picked: [] })).toEqual({
      kind: 'text',
      text: 'Neither',
    });
  });

  it('reads the labels an answer chose', () => {
    expect(chosenOf({ kind: 'multi', choices: ['Client', 'Both'] })).toEqual(['Client', 'Both']);
    expect(chosenOf({ kind: 'text', text: 'x' })).toEqual([]);
    expect(chosenOf(null)).toEqual([]);
  });
});
