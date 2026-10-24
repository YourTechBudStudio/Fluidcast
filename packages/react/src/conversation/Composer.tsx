import { ArrowUp, RotateCcw, Square } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { Skill } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { Button, useDomId } from '../ui';
import type { ComposerMode } from './presentation';
import { SkillMenu } from './SkillMenu';
import { completeSkill, firstWord, matchSkills, menuQuery, skillPrefixLength } from './skills';

export interface ComposerProps {
  readonly mode: ComposerMode;
  /** Resolves `true` once the message was accepted; only then is the draft cleared. */
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onInterrupt: () => void;
  readonly onRetry: () => void;
  readonly onRetryClip: () => void;
  /** The worker's skills, for suggestions while a leading `/name` is typed. Empty: no suggestions. */
  readonly skills: ReadonlyArray<Skill>;
  /** Where the suggestions render, above the dock; `null` until it mounts. */
  readonly menuSlot: HTMLElement | null;
}

type Action = { readonly id: string; readonly el: ReactNode; readonly label: string };

/**
 * The text box and the one or two buttons that fit the moment: Send, Interrupt, Retry, or Retry clip. Contents only:
 * the dock around it owns the surface.
 *
 * While the caret is in a first word that starts with `/`, a menu suggests the worker's skills; completing one writes
 * `/name `. The text box stays the only source of the message, and a leading `/name` the Agent tool will read as a
 * skill shows in violet through a mirror behind the text.
 */
export function Composer({
  mode,
  onSend,
  onInterrupt,
  onRetry,
  onRetryClip,
  skills,
  menuSlot,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  // The first word the listener dismissed the menu on, with Esc: it stays shut until that word changes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const caretAfterRender = useRef<number | null>(null);
  const listboxId = useDomId('fc-skills');
  const typed = text.trim().length > 0;
  const editable = mode === 'compose' || mode === 'retry';

  const query = editable && focused ? menuQuery(text, selection) : undefined;
  const matches = query === undefined || skills.length === 0 ? [] : matchSkills(skills, query);
  const open = menuSlot !== null && matches.length > 0 && firstWord(text) !== dismissed;
  const highlight = Math.min(active, Math.max(matches.length - 1, 0));
  const optionId = (index: number) => `${listboxId}-${index}`;
  const coloured = editable ? skillPrefixLength(text) : 0;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    if (caretAfterRender.current !== null) {
      el.setSelectionRange(caretAfterRender.current, caretAfterRender.current);
      caretAfterRender.current = null;
      // Read it back: a select event for the key that completed can report the caret from before.
      setSelection({ start: el.selectionStart, end: el.selectionEnd });
    }
    if (mirror.current) mirror.current.scrollTop = el.scrollTop;
  }, [text]);

  // A new query starts at the best match.
  useEffect(() => setActive(0), [query]);

  const readSelection = (el: HTMLTextAreaElement) =>
    setSelection({ start: el.selectionStart, end: el.selectionEnd });

  const complete = (index: number) => {
    const match = matches[index];
    if (!match) return;
    const next = completeSkill(text, match.skill.name);
    caretAfterRender.current = next.caret;
    setText(next.text);
    setSelection({ start: next.caret, end: next.caret });
  };

  // The menu's keys, handled at the text box itself, before they bubble to the player root: a handled key is marked
  // with `preventDefault` (never stopped), so the player's own Escape and the Enter-to-send below skip it. With the
  // menu shut, every key is left alone.
  const menuKeys = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  menuKeys.current = (event) => {
    if (!open || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((highlight + 1) % matches.length);
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((highlight - 1 + matches.length) % matches.length);
        return;
      case 'Tab':
      case 'Enter':
        if (event.shiftKey) return;
        event.preventDefault();
        complete(highlight);
        return;
      case 'Escape':
        event.preventDefault();
        setDismissed(firstWord(text));
    }
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const listener = (event: globalThis.KeyboardEvent) => menuKeys.current(event);
    el.addEventListener('keydown', listener);
    return () => el.removeEventListener('keydown', listener);
  }, []);

  const send = () => {
    if (!editable || !typed) return;
    const sent = text;
    void onSend(sent.trim()).then((accepted) => {
      // Keep anything typed while the command was in flight.
      if (accepted) setText((current) => (current === sent ? '' : current));
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // The skill menu took it.
    if (event.nativeEvent.defaultPrevented) return;
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
    <form onSubmit={(event) => event.preventDefault()}>
      <div className="flex flex-wrap items-end gap-2 py-2 pr-2 pl-4.5 compact:pl-3.5">
        <div className="relative flex min-w-0 flex-1">
          {coloured > 0 && (
            // The text box's text, drawn behind it with the skill coloured: same box, font and wrapping, scrolled with it.
            <div
              ref={mirror}
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden py-[11px] text-base leading-[22px] wrap-break-word whitespace-pre-wrap text-fg"
            >
              <span className="text-violet">{text.slice(0, coloured)}</span>
              {text.slice(coloured)}
              {/* Keeps a trailing blank line, which the text box shows and a div drops, so both scroll alike. */}
              {'\u200b'}
            </div>
          )}
          <textarea
            ref={box}
            rows={1}
            value={text}
            disabled={!editable}
            onChange={(event) => {
              setText(event.target.value);
              if (firstWord(event.target.value) !== dismissed) setDismissed(null);
              readSelection(event.target);
            }}
            onSelect={(event) => readSelection(event.currentTarget)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onScroll={(event) => {
              if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop;
            }}
            onKeyDown={onKeyDown}
            placeholder="Reply or steer…"
            aria-label="Message"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={open ? optionId(highlight) : undefined}
            className={`relative max-h-30 min-h-11 w-full min-w-0 resize-none bg-transparent py-[11px] text-base leading-[22px] outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:text-fg-subtle ${coloured > 0 ? 'text-transparent caret-fg' : 'text-fg'}`}
          />
        </div>
        <div
          className={`flex shrink-0 gap-1.5 ${actions.length > 1 ? 'compact:basis-full compact:justify-end' : ''}`}
        >
          {actions.map((action) => (
            <span
              key={action.id}
              className="contents motion-safe:[&>button]:animate-[fc-act-in_var(--duration-surface)_var(--ease-expo)]"
            >
              {action.el}
            </span>
          ))}
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      {open && menuSlot !== null && (
        <SkillMenu
          id={listboxId}
          optionId={optionId}
          matches={matches}
          total={skills.length}
          active={highlight}
          onHighlight={setActive}
          onPick={complete}
          slot={menuSlot}
        />
      )}
    </form>
  );
}
