import { ArrowRight, ArrowUp, Check, Clock } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { AskCommand, AskInput } from '@yourtechbudstudio/fluidcast-tool-ask/schema';

import { Button, Kbd, Swap, typingTarget } from '../../ui';
import { type AskDraft, answerForOption, answerForSend, chosenOf, toggled } from './draft';

export interface AskFormProps {
  readonly input: AskInput;
  /** `open` takes an answer; `sent` shows the answer as sent while it waits to go through. */
  readonly mode: 'open' | 'sent';
  /** The answer as sent, in `sent` mode. */
  readonly answer?: AskCommand | undefined;
  /** A line is still playing, so a sent answer goes through when it ends. */
  readonly narrating: boolean;
  /** Nothing can be sent, for example while disconnected. */
  readonly disabled: boolean;
  /** Resolves `true` once the answer was accepted. The draft is kept otherwise. */
  readonly onSubmit: (answer: AskCommand) => Promise<boolean>;
  /** A control the moment calls for: Retry clip while open, or Interrupt once sent. */
  readonly extra?: ReactNode;
}

const HINT: Record<AskInput['kind'], string> = {
  text: 'Type your answer',
  choice: 'Pick one, or say it your way',
  multi: 'Pick any, then send',
};

/**
 * One question in place of the composer, without chrome: the dock around it owns the surface. The question stays
 * put while the body below it swaps between the open form and the answer as sent. Free text is always available.
 */
export function AskForm({
  input,
  mode,
  answer,
  narrating,
  disabled,
  onSubmit,
  extra,
}: AskFormProps) {
  const [draft, setDraft] = useState<AskDraft>({ text: '', picked: [] });
  const [sending, setSending] = useState(false);
  const blocked = disabled || sending || mode !== 'open';
  const options = input.kind === 'text' ? [] : input.options;
  const described = options.some((option) => option.description);
  const multi = input.kind === 'multi';
  const sendable = answerForSend(input, draft);

  const submit = (next: AskCommand | undefined) => {
    if (blocked || !next) return;
    setSending(true);
    void onSubmit(next).finally(() => setSending(false));
  };
  const choose = (index: number) => {
    if (blocked) return;
    if (multi) setDraft((current) => toggled(current, index));
    else submit(answerForOption(input, draft, index));
  };

  // Number keys pick options when no typing target has focus.
  const latestChoose = useRef(choose);
  latestChoose.current = choose;
  useEffect(() => {
    if (mode !== 'open' || options.length === 0) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (typingTarget(event.target)) return;
      const n = Number(event.key);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, options.length)) {
        event.preventDefault();
        latestChoose.current(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, options.length]);

  const sendLabel =
    multi && draft.picked.length > 0
      ? `Send ${draft.picked.length} ${draft.picked.length === 1 ? 'pick' : 'picks'}`
      : undefined;

  return (
    <section aria-label="Question" className="relative p-4 pb-3.5 max-sm:p-3.5 max-sm:pb-3">
      <div className="flex items-baseline justify-between gap-4 px-1">
        <span
          key={mode}
          className="motion-safe:animate-[status-in_var(--duration-surface)_var(--ease-expo)]"
        >
          <AskingLabel mode={mode} />
        </span>
        <span
          className={`font-mono text-[11px] tracking-[0.04em] text-fg-subtle transition-opacity duration-(--duration-ui) ease-expo max-sm:hidden ${mode === 'open' ? 'opacity-100' : 'opacity-0'}`}
        >
          {HINT[input.kind]}
        </span>
      </div>
      <h2 className="mt-2 px-1 font-display text-[19px] leading-snug font-normal tracking-[-0.01em] text-balance text-fg">
        {input.question}
      </h2>

      <Swap contentKey={mode === 'sent' && answer ? 'sent' : 'open'}>
        {mode === 'sent' && answer ? (
          <div className="mt-3.5 px-1">
            <SentAnswer answer={answer} narrating={narrating} extra={extra} />
          </div>
        ) : (
          <div>
            {options.length > 0 && (
              <div
                role="group"
                aria-label="Options"
                className={
                  described
                    ? 'mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2 max-sm:grid-cols-1'
                    : 'mt-3.5 flex flex-wrap gap-2 max-sm:flex-col'
                }
              >
                {options.map((option, i) => {
                  const on = draft.picked.includes(i);
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={multi ? on : undefined}
                      aria-disabled={blocked || undefined}
                      aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                      onClick={() => choose(i)}
                      style={{ animationDelay: `${120 + i * 45}ms` }}
                      className={`rise-in group relative flex min-h-11 cursor-pointer items-center gap-3 border text-left transition-[background-color,border-color,color,opacity] duration-(--duration-ui) ease-expo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue aria-disabled:cursor-default aria-disabled:opacity-45 ${
                        described
                          ? 'items-start rounded-md px-3.5 py-3 max-sm:py-2.5'
                          : 'rounded-full py-1.5 pr-4 pl-2 max-sm:rounded-md max-sm:pl-3.5'
                      } ${
                        on
                          ? 'border-cyan/60 bg-cyan/12 text-fg'
                          : 'border-line/45 bg-subtle/55 text-fg hover:border-cyan/45 hover:bg-cyan/7'
                      }`}
                    >
                      <span
                        className={`grid shrink-0 place-items-center ${described ? 'mt-0.5' : ''} ${multi ? '' : 'max-sm:hidden'}`}
                      >
                        {multi ? (
                          <span
                            className={`grid size-[18px] place-items-center rounded-[5px] border transition-colors duration-(--duration-ui) ${on ? 'border-cyan bg-cyan text-scrim' : 'border-line/70'}`}
                          >
                            {on && <Check size={12} strokeWidth={3} aria-hidden />}
                          </span>
                        ) : (
                          i < 9 && <Kbd>{i + 1}</Kbd>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15.5px] font-semibold">{option.label}</span>
                        {option.description && (
                          <span className="mt-0.5 block text-[13.5px] leading-snug text-fg-subtle">
                            {option.description}
                          </span>
                        )}
                      </span>
                      {input.kind === 'choice' && (
                        <ArrowRight
                          size={15}
                          strokeWidth={2}
                          aria-hidden
                          className={`shrink-0 text-cyan opacity-0 transition-opacity duration-(--duration-ui) group-hover:opacity-100 group-focus-visible:opacity-100 max-sm:opacity-70 ${described ? 'mt-1' : ''}`}
                        />
                      )}
                      {multi && described && i < 9 && (
                        <span className="absolute top-3 right-3.5 max-sm:hidden">
                          <Kbd>{i + 1}</Kbd>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <FreeText
              input={input}
              text={draft.text}
              disabled={disabled}
              canSend={!blocked && sendable !== undefined}
              sendLabel={sendLabel}
              onText={(text) => setDraft((current) => ({ ...current, text }))}
              onSend={() => submit(sendable)}
            />
            {extra && <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">{extra}</div>}
          </div>
        )}
      </Swap>
    </section>
  );
}

/** The small "asking" label: a cyan attention dot that breathes while the question is open. */
function AskingLabel({ mode }: { readonly mode: 'open' | 'sent' }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.07em] text-cyan uppercase">
      <i
        aria-hidden
        className={`size-1.5 rounded-full ${mode === 'open' ? 'bg-cyan shadow-[0_0_10px_var(--color-cyan)] motion-safe:animate-breathe' : 'bg-fg-subtle'}`}
      />
      {mode === 'open' ? 'Asking you' : 'You answered'}
    </span>
  );
}

/** The auto-growing text field and its send button: the Ask's always-present escape hatch. */
function FreeText({
  input,
  text,
  disabled,
  canSend,
  sendLabel,
  onText,
  onSend,
}: {
  readonly input: AskInput;
  readonly text: string;
  readonly disabled: boolean;
  readonly canSend: boolean;
  readonly sendLabel: string | undefined;
  readonly onText: (text: string) => void;
  readonly onSend: () => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  };
  return (
    <div className="mt-3 flex items-end gap-2 rounded-md border border-line/35 bg-scrim/35 py-1 pr-1 pl-3.5 transition-colors duration-(--duration-ui) ease-expo focus-within:border-cyan/45">
      <textarea
        ref={box}
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={input.kind === 'text' ? 'Type your answer…' : 'Or say something else…'}
        aria-label="Your answer"
        className="max-h-30 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-[11px] text-base leading-[22px] text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:text-fg-subtle"
      />
      <Button
        tone={canSend ? 'primary' : 'quiet'}
        unavailable={!canSend}
        aria-label={sendLabel ?? 'Send answer'}
        icon={<ArrowUp size={16} strokeWidth={1.9} aria-hidden />}
        onClick={onSend}
      >
        {sendLabel ?? 'Send'}
      </Button>
    </div>
  );
}

/** The answer as sent, read-only, while it waits to go through. */
function SentAnswer({
  answer,
  narrating,
  extra,
}: {
  readonly answer: AskCommand;
  readonly narrating: boolean;
  readonly extra: ReactNode;
}) {
  const chosen = chosenOf(answer);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {chosen.map((label) => (
          <span
            key={label}
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-cyan/35 bg-cyan/10 px-3.5 text-[15px] text-fg"
          >
            <Check size={14} strokeWidth={2.2} className="text-cyan" aria-hidden />
            {label}
          </span>
        ))}
        {answer.text && (
          <span className="min-w-0 text-[15px] text-fg-muted italic">
            {chosen.length ? '+ ' : ''}“{answer.text}”
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 max-sm:basis-full">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px] tracking-[0.03em] text-fg-subtle">
          {narrating ? (
            <>
              <Clock size={12} strokeWidth={2} aria-hidden /> Sent · goes through when this line
              ends
            </>
          ) : (
            <>
              <Check size={12} strokeWidth={2.2} aria-hidden /> Sent
            </>
          )}
        </span>
        {extra && <span className="max-sm:basis-full max-sm:[&>button]:w-full">{extra}</span>}
      </div>
    </div>
  );
}
