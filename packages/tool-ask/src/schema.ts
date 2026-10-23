/**
 * The Ask tool's contract: everything a client needs to recognise a question, present it and
 * answer it. A pure export: it imports only `effect`.
 */
import { Schema } from 'effect';

/** The model-facing action `type` of an Ask. */
export const askToolName = 'ask';

// No `identifier`: nested schemas render inline in the prompt.
// Labels only: a description invites the model to invent trade-offs the worker never gave.
const AskOption = Schema.Struct({
  label: Schema.String.annotate({ description: 'A short answer the listener can pick.' }),
});
const Options = Schema.Array(AskOption).check(Schema.isMinLength(1));
const Question = Schema.String.annotate({ description: 'Exactly one question.' });

/**
 * What the model writes: one question, answered in free text or by choosing among options, or a
 * `continue` checkpoint the listener acknowledges, optionally with a note.
 */
export const AskInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('text'), question: Question }),
  Schema.Struct({ kind: Schema.Literal('choice'), question: Question, options: Options }),
  Schema.Struct({ kind: Schema.Literal('multi'), question: Question, options: Options }),
  Schema.Struct({ kind: Schema.Literal('continue'), question: Question }),
]);
export type AskInput = typeof AskInput.Type;

/**
 * Every answer shape a client can send. A `choice`, `multi` or `continue` answer may carry free text
 * the listener typed alongside: for `continue`, a note on the segment. Which answers a given question
 * accepts is `askAnswerSchema`.
 */
export const AskCommand = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('text'), text: Schema.NonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal('choice'),
    choice: Schema.NonEmptyString,
    text: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal('multi'),
    choices: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
    text: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal('continue'), text: Schema.optionalKey(Schema.String) }),
]);
export type AskCommand = typeof AskCommand.Type;

/**
 * The free text a `choice`, `multi` or `continue` answer carries alongside, trimmed; `undefined` when
 * it is blank or absent. A `text` answer's text is the answer itself, not a note, so it has none.
 */
export const askNote = (answer: AskCommand): string | undefined => {
  if (answer.kind === 'text') return undefined;
  const note = answer.text?.trim();
  return note ? note : undefined;
};

/** The question as asked and the listener's answer. */
export const AskResult = Schema.Struct({ question: Schema.String, answer: AskCommand });
export type AskResult = typeof AskResult.Type;

/**
 * The answers this question accepts, narrowing `AskCommand`: free text for every kind except
 * `continue`; for `choice`, one offered label; for `multi`, one or more distinct offered labels;
 * for `continue`, only a `continue` answer. A client can use it to check an answer before sending it.
 */
export const askAnswerSchema = (input: AskInput): Schema.Codec<AskCommand, Schema.Json> => {
  const labels = new Set(
    input.kind === 'choice' || input.kind === 'multi'
      ? input.options.map((option) => option.label)
      : [],
  );
  return AskCommand.check(
    Schema.makeFilter(
      (answer) => {
        switch (answer.kind) {
          case 'text':
            return input.kind !== 'continue';
          case 'choice':
            return input.kind === 'choice' && labels.has(answer.choice);
          case 'multi':
            return (
              input.kind === 'multi' &&
              new Set(answer.choices).size === answer.choices.length &&
              answer.choices.every((choice) => labels.has(choice))
            );
          case 'continue':
            return input.kind === 'continue';
        }
      },
      { expected: 'an answer this question offers' },
    ),
  );
};
