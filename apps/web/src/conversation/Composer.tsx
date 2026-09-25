import { ArrowUp, RotateCcw, Square } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '../ui';
import type { ComposerMode } from './presentation';

export interface ComposerProps {
  readonly mode: ComposerMode;
  readonly onSend: (text: string) => void;
  readonly onInterrupt: () => void;
  readonly onRetry: () => void;
  readonly onRetryClip: () => void;
}

type Action = { readonly id: string; readonly el: ReactNode; readonly label: string };

/** The text box and the one or two buttons that fit the moment: Send, Interrupt, Retry, or Retry clip. */
export function Composer({ mode, onSend, onInterrupt, onRetry, onRetryClip }: ComposerProps) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const typed = text.trim().length > 0;
  const editable = mode === 'compose' || mode === 'retry';

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const send = () => {
    if (!editable || !typed) return;
    onSend(text.trim());
    setText('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const icon = { size: 16, strokeWidth: 1.8, 'aria-hidden': true } as const;
  const sendButton: Action = {
    id: 'send',
    label: 'Send',
    el: (
      <Button
        key="send"
        tone="primary"
        icon={<ArrowUp {...icon} />}
        unavailable={!typed}
        onClick={send}
      >
        Send
      </Button>
    ),
  };
  const interrupt: Action = {
    id: 'interrupt',
    label: 'Interrupt',
    el: (
      <Button
        key="interrupt"
        tone="quiet"
        icon={<Square size={12} fill="currentColor" strokeWidth={0} aria-hidden />}
        onClick={onInterrupt}
      >
        Interrupt
      </Button>
    ),
  };
  const actions: Action[] =
    mode === 'compose'
      ? [sendButton]
      : mode === 'busy'
        ? [interrupt]
        : mode === 'retry'
          ? [
              {
                id: 'retry',
                label: 'Retry',
                el: (
                  <Button
                    key="retry"
                    tone={typed ? 'quiet' : 'danger'}
                    icon={<RotateCcw {...icon} />}
                    onClick={onRetry}
                  >
                    Retry
                  </Button>
                ),
              },
              ...(typed ? [sendButton] : []),
            ]
          : mode === 'retryClip'
            ? [
                {
                  id: 'retry-clip',
                  label: 'Retry clip',
                  el: (
                    <Button
                      key="retry-clip"
                      tone="danger"
                      icon={<RotateCcw {...icon} />}
                      onClick={onRetryClip}
                    >
                      Retry clip
                    </Button>
                  ),
                },
                interrupt,
              ]
            : [];

  const announcement = actions.length
    ? `${actions.map((a) => a.label).join(' and ')} available`
    : 'Controls unavailable while disconnected';

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="mx-auto max-w-170 rounded-lg border border-line/42 bg-elevated/42 shadow-soft backdrop-blur-xl backdrop-saturate-130 transition-colors duration-(--duration-surface) ease-expo focus-within:border-blue/45"
    >
      <div className="flex flex-wrap items-end gap-2 py-2 pr-2 pl-4.5 max-sm:pl-3.5">
        <textarea
          ref={box}
          rows={1}
          value={text}
          disabled={!editable}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Reply or steer…"
          aria-label="Message"
          className="max-h-30 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-[11px] text-base leading-[22px] text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:text-fg-subtle"
        />
        <div
          className={`flex shrink-0 gap-1.5 ${actions.length > 1 ? 'max-sm:basis-full max-sm:justify-end' : ''}`}
        >
          {actions.map((action) => (
            <span
              key={action.id}
              className="contents motion-safe:[&>button]:animate-[act-in_var(--duration-surface)_var(--ease-expo)]"
            >
              {action.el}
            </span>
          ))}
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </form>
  );
}
