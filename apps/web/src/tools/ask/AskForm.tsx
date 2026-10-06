import { ArrowRight, ArrowUp, Check, Clock, CornerDownLeft, Hand, Pencil } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { AskCommand, AskInput } from '@yourtechbudstudio/fluidcast-tool-ask/schema';

import { Button, Kbd, Swap, typingTarget } from '../../ui';
import { AskAnswer } from './AskCard';
import {
  ASK_KIND_LABEL,
  type AskDraft,
  answerForOption,
  answerForSend,
  optionsOf,
  toggled,
} from './draft';

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
  /** Declines the question to say something else: the session's ordinary Interrupt. */
  readonly onInterrupt: () => void;
  /** A control the moment calls for: Retry clip while open, or Interrupt once sent. */
  readonly extra?: ReactNode;
}

/**
 * One question in place of the composer, without chrome: the dock around it owns the surface. A header names the
 * kind and holds Interrupt; the question stays put while the body below it swaps between the open form and the
 * answer as sent. Options are a quiet list of rows, and free text is the last row, for every kind except `continue`,
 * a checkpoint answered only with its full-width Continue button. Interrupt declines the question without answering
 * it, stops the narration, and hands back the composer for what the listener wants to say instead.
 */
export function AskForm({
  input,
  mode,
  answer,
  narrating,
  disabled,
  onSubmit,
  onInterrupt,
  extra,
}: AskFormProps) {
  const [draft, setDraft] = useState<AskDraft>({ text: '', picked: [] });
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const blocked = disabled || sending || mode !== 'open';
  const options = optionsOf(input);
  const multi = input.kind === 'multi';
  const checkpoint = input.kind === 'continue';
  // Number keys: one per option, or `1` for a checkpoint's Continue.
  const keys = checkpoint ? 1 : options.length;
  const sendable = answerForSend(input, draft);

  const submit = (next: AskCommand | undefined) => {
    if (blocked || !next) return;
    setSending(true);
    void onSubmit(next).finally(() => setSending(false));
  };
  const interrupt = () => {
    if (!blocked) onInterrupt();
  };
  const choose = (index: number) => {
    if (blocked) return;
    if (checkpoint) submit({ kind: 'continue' });
    else if (multi) setDraft((current) => toggled(current, index));
    else submit(answerForOption(input, draft, index));
  };

  // Number keys pick options, or Continue, when no typing target has focus. A checkpoint's Continue also takes Enter,
  // unless a focused control would take that Enter itself.
  const latestChoose = useRef(choose);
  latestChoose.current = choose;
  useEffect(() => {
    if (mode !== 'open' || keys === 0) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (typingTarget(event.target)) return;
      if (event.key === 'Enter') {
        if (!checkpoint || event.shiftKey || interactive(event.target)) return;
        event.preventDefault();
        latestChoose.current(0);
        return;
      }
      const n = Number(event.key);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, keys)) {
        event.preventDefault();
        latestChoose.current(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, keys, checkpoint]);

  const picks = draft.picked.length;

  return (
    <section aria-label="Question" className="relative p-4 pb-3.5 max-sm:p-3.5 max-sm:pb-3">
      <div className="flex min-h-8 items-center justify-between gap-4 px-1">
        <span
          key={mode}
          className="motion-safe:animate-[status-in_var(--duration-surface)_var(--ease-expo)]"
        >
          <AskingLabel mode={mode} kind={input.kind} />
        </span>
        {mode === 'open' && (
          <div className="-my-1.5 -mr-2 flex items-center gap-1">
            {extra}
            <Button
              tone="ghost"
              unavailable={blocked}
              title="Skip this question and say something else instead"
              icon={<Hand size={14} strokeWidth={1.9} aria-hidden />}
              onClick={interrupt}
              className="text-[14px]"
            >
              Interrupt
            </Button>
          </div>
        )}
      </div>
      <h2 className="mt-1.5 px-1 font-display text-[19px] leading-snug font-normal tracking-[-0.01em] text-balance text-fg">
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
              <div role="group" aria-label="Options" className="mt-3 flex flex-col gap-0.5">
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
                      className={`rise-in group flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-sm px-2.5 py-2 text-left text-[15.5px] text-fg transition-[background-color,opacity] duration-(--duration-ui) ease-expo focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-blue aria-disabled:cursor-default aria-disabled:opacity-45 ${
                        on ? 'bg-cyan/11' : 'hover:bg-cyan/8 focus-visible:bg-cyan/8'
                      }`}
                    >
                      {multi && (
                        <span
                          aria-hidden
                          className={`grid size-[17px] shrink-0 place-items-center rounded-[5px] border transition-colors duration-(--duration-ui) ${on ? 'border-cyan bg-cyan text-scrim' : 'border-line/85'}`}
                        >
                          {on && <Check size={11} strokeWidth={3} />}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">{option.label}</span>
                      {input.kind === 'choice' && (
                        <ArrowRight
                          size={15}
                          strokeWidth={2}
                          aria-hidden
                          className="shrink-0 text-cyan opacity-0 transition-opacity duration-(--duration-ui) group-hover:opacity-100 group-focus-visible:opacity-100"
                        />
                      )}
                      {i < 9 && (
                        <span className="max-sm:hidden">
                          <Kbd>{i + 1}</Kbd>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {checkpoint ? (
              <Button
                tone="primary"
                unavailable={blocked}
                aria-keyshortcuts="Enter 1"
                onClick={() => choose(0)}
                className="mt-3.5 min-h-12 w-full rounded-sm"
              >
                Continue
                <kbd
                  aria-hidden
                  className="grid place-items-center rounded-[4px] bg-scrim/12 px-1 py-0.5 text-scrim/65 shadow-[inset_0_0_0_1px_rgb(20_22_34/0.18)]"
                >
                  <CornerDownLeft size={12} strokeWidth={2.2} />
                </kbd>
              </Button>
            ) : (
              <FreeText
                box={box}
                text={draft.text}
                divided={options.length > 0}
                placeholder={
                  input.kind === 'text'
                    ? 'Type your answer…'
                    : picks > 0
                      ? 'Add a note…'
                      : 'Something else…'
                }
                disabled={disabled}
                canSend={!blocked && sendable !== undefined}
                sendLabel={multi && picks > 0 ? `Send ${picks}` : undefined}
                onText={(text) => setDraft((current) => ({ ...current, text }))}
                onSend={() => submit(sendable)}
              />
            )}
          </div>
        )}
      </Swap>
    </section>
  );
}

/** Whether a key event lands on a control that handles Enter itself, such as a focused button or link. */
const interactive = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('button, a[href], summary') !== null;

/** The small label above the question: the kind, with a cyan attention dot that breathes while the question is open. */
function AskingLabel({
  mode,
  kind,
}: {
  readonly mode: 'open' | 'sent';
  readonly kind: AskInput['kind'];
}) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.07em] text-cyan uppercase">
      <i
        aria-hidden
        className={`size-1.5 rounded-full ${mode === 'open' ? 'bg-cyan shadow-[0_0_10px_var(--color-cyan)] motion-safe:animate-breathe' : 'bg-fg-subtle'}`}
      />
      {mode === 'open' ? ASK_KIND_LABEL[kind] : 'You answered'}
    </span>
  );
}

/**
 * The free-text row: the Ask's always-present escape hatch, and the whole answer for an open question. Below options
 * a divider sets it apart; alone, it needs none. It has no box at rest; a cyan edge shows only while it has focus.
 */
function FreeText({
  box,
  text,
  divided,
  placeholder,
  disabled,
  canSend,
  sendLabel,
  onText,
  onSend,
}: {
  readonly box: RefObject<HTMLTextAreaElement | null>;
  readonly text: string;
  readonly divided: boolean;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly canSend: boolean;
  readonly sendLabel: string | undefined;
  readonly onText: (text: string) => void;
  readonly onSend: () => void;
}) {
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [box, text]);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  };
  return (
    <div className={divided ? 'mt-1.5 border-t border-line/22 pt-1.5' : 'mt-2'}>
      <div className="group flex items-end gap-3 rounded-sm border border-transparent pl-2.5 transition-colors duration-(--duration-ui) ease-expo focus-within:border-cyan/45">
        <Pencil
          size={14}
          strokeWidth={1.8}
          aria-hidden
          className="mb-[15px] shrink-0 text-fg-subtle transition-colors duration-(--duration-ui) group-focus-within:text-cyan"
        />
        <textarea
          ref={box}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Your answer"
          className="max-h-30 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-[11px] text-[15.5px] leading-[22px] text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:text-fg-subtle"
        />
        <Button
          tone={canSend ? 'primary' : 'quiet'}
          unavailable={!canSend}
          aria-label={sendLabel ?? 'Send answer'}
          icon={<ArrowUp size={16} strokeWidth={1.9} aria-hidden />}
          onClick={onSend}
        >
          {sendLabel}
        </Button>
      </div>
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
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <AskAnswer answer={answer} />
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
