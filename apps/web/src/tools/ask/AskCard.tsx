import { Check, User } from 'lucide-react';

import type { AskCommand, AskInput } from '@yourtechbudstudio/fluidcast-tool-ask/schema';

import { Chip } from '../../ui';
import { chosenOf, optionsOf, typedOf } from './draft';

const KIND_LABEL: Record<AskInput['kind'], string> = {
  text: 'Open answer',
  choice: 'Pick one',
  multi: 'Pick any',
  continue: 'Continue',
};

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
        {KIND_LABEL[input.kind]}
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

/**
 * The question with every option offered: yours checked, the rest dimmed, and anything you typed as a quote. A
 * `continue` checkpoint offers no options, so its answer shows as a checked Continue row.
 */
export function AskCard({
  input,
  answer,
}: {
  readonly input: AskInput;
  readonly answer: AskCommand | null;
}) {
  const chosen = chosenOf(answer);
  const options = optionsOf(input);
  const typed = typedOf(answer);
  return (
    <div className="mt-0.5 overflow-hidden rounded-lg border border-line/35 bg-elevated/40">
      <p className="px-4 pt-3 pb-2.5 font-display text-[16.5px] leading-snug text-fg">
        {input.question}
      </p>
      {options.length > 0 && (
        <ul className="border-t border-line/20">
          {options.map((option) => {
            const on = chosen.includes(option.label);
            return (
              <li
                key={option.label}
                className={`flex items-start gap-3 border-b border-line/15 px-4 py-2.5 last:border-b-0 ${on ? 'bg-cyan/7' : answer ? 'opacity-55' : ''}`}
              >
                <span
                  aria-hidden
                  className={`mt-[3px] grid size-4 shrink-0 place-items-center border ${input.kind === 'multi' ? 'rounded-[4px]' : 'rounded-full'} ${on ? 'border-cyan bg-cyan text-scrim' : 'border-line/70'}`}
                >
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span
                  className={`min-w-0 text-[14.5px] ${on ? 'font-semibold text-fg' : 'text-fg-muted'}`}
                >
                  {option.label}
                  {on && <span className="sr-only"> (your answer)</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {answer?.kind === 'continue' && (
        <p className="flex items-center gap-3 border-t border-line/20 bg-cyan/7 px-4 py-2.5 text-[14.5px] font-semibold text-fg">
          <span
            aria-hidden
            className="grid size-4 shrink-0 place-items-center rounded-full border border-cyan bg-cyan text-scrim"
          >
            <Check size={11} strokeWidth={3} />
          </span>
          Continue
          <span className="sr-only"> (your answer)</span>
        </p>
      )}
      {typed && (
        <p className="flex items-start gap-2 border-t border-line/20 px-4 py-2.5 text-[14.5px] text-fg-muted italic">
          <User size={13} strokeWidth={1.8} className="mt-1 shrink-0 not-italic" aria-hidden />“
          {typed}”
        </p>
      )}
    </div>
  );
}
