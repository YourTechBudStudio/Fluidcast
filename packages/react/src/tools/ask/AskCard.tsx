import type { AskCommand, AskInput } from '@yourtechbudstudio/fluidcast-tool-ask/schema';

import { Chip } from '../../ui';
import { ASK_KIND_LABEL, chosenOf, typedOf } from './draft';

/**
 * Where a question stands: `live` while it waits for an answer, `pending` once answered but not yet sent on,
 * `answered` once the model has read the answer, and `unanswered` if the question closed without one.
 */
export type AskCardState = 'live' | 'pending' | 'answered' | 'unanswered';

/** A question's heading in the transcript: "Asked", its kind and its state. */
export function AskCardTitle({
  input,
  state,
}: {
  readonly input: AskInput;
  readonly state: AskCardState;
}) {
  return (
    <>
      <span className="text-fg-subtle">Asked</span>
      <span className="font-mono text-[11px] tracking-[0.04em] text-fg-subtle uppercase">
        {ASK_KIND_LABEL[input.kind]}
      </span>
      {state === 'live' && (
        <Chip tone="blue" live>
          Waiting for your answer
        </Chip>
      )}
      {state === 'pending' && (
        <Chip tone="violet" live>
          Waiting to send
        </Chip>
      )}
    </>
  );
}

/** The question and, once given, the answer beneath it. */
export function AskCard({
  input,
  answer,
}: {
  readonly input: AskInput;
  readonly answer: AskCommand | null;
}) {
  return (
    <div className="mt-0.5 rounded-sm border border-line/25 bg-elevated/30 px-4 py-3">
      <p className="font-display text-[16px] leading-snug text-fg">{input.question}</p>
      {answer && (
        <div className="mt-2">
          <AskAnswer answer={answer} />
        </div>
      )}
    </div>
  );
}

/**
 * An answer as one arrowed line: the options chosen, or the typed text when nothing was chosen. Text typed alongside
 * a choice follows as a quote, and a `continue` answer reads "Continued".
 */
export function AskAnswer({ answer }: { readonly answer: AskCommand }) {
  const chosen = chosenOf(answer);
  const typed = typedOf(answer);
  const lead = answer.kind === 'continue' ? 'Continued' : chosen.length ? chosen.join(', ') : typed;
  const note = chosen.length > 0 ? typed : undefined;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-[14.5px] leading-snug">
      <span aria-hidden className="font-mono text-[12.5px] text-cyan">
        →
      </span>
      <p className={answer.kind === 'continue' ? 'text-fg-muted' : 'text-fg'}>
        <span className="sr-only">Your answer: </span>
        {lead}
      </p>
      {note && <p className="col-start-2 text-fg-muted italic">“{note}”</p>}
    </div>
  );
}
