import { Effect } from 'effect';

import type { Tool } from '@yourtechbudstudio/fluidcast-harness';

import { askAnswerSchema, AskCommand, AskInput, AskResult, askToolName } from './schema.ts';

export * from './schema.ts';

/**
 * The Ask tool: puts one question in front of the listener and waits for the answer. It blocks the
 * conversation until answered, the model always reads the answer, and it never executes again on
 * replay. The Harness accepts only answers the question offers, so `run` takes the first one.
 */
export const askTool = (): Tool<AskInput, AskResult, AskCommand> => ({
  name: askToolName,
  input: AskInput,
  guidelines: [
    'Use `ask` for one question that needs the listener\'s answer. `ask` blocks: the conversation waits for the answer, which arrives as a `<tool_result>`. `kind: "continue"` is a checkpoint the listener only acknowledges with a Continue button; every other kind can also be answered in the listener\'s own words.',
  ],
  result: AskResult,
  renderResult: renderAnswer,
  policy: { blocking: true, response: 'all', replay: false },
  command: askAnswerSchema,
  run: (input, context) =>
    Effect.map(context.awaitCommand, (answer) => ({ question: input.question, answer })),
});

/** What the model reads: the question, the answer, and any free text given alongside options. */
const renderAnswer = ({ question, answer }: AskResult): string => {
  const lines = [`Question: ${question}`];
  switch (answer.kind) {
    case 'text':
      lines.push(`Answer, in their own words: ${answer.text}`);
      break;
    case 'choice':
      lines.push(`Answer: ${answer.choice}`);
      break;
    case 'multi':
      lines.push(`Answer: ${answer.choices.join('; ')}`);
      break;
    case 'continue':
      lines.push('Answer: Continue');
      break;
  }
  if (
    (answer.kind === 'choice' || answer.kind === 'multi') &&
    answer.text !== undefined &&
    answer.text.trim() !== ''
  ) {
    lines.push(`They added: ${answer.text.trim()}`);
  }
  return lines.join('\n');
};
