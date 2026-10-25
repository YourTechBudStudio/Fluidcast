import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { usePlayerInstance } from '../ui';
import type { SkillMatch } from './skills';

export interface SkillMenuProps {
  /** The listbox's id, which the composer's text box controls. */
  readonly id: string;
  /** Each option's id, for the text box's `aria-activedescendant`. */
  readonly optionId: (index: number) => string;
  readonly matches: ReadonlyArray<SkillMatch>;
  /** How many skills the list holds, for the header's "n of total". */
  readonly total: number;
  readonly active: number;
  readonly onHighlight: (index: number) => void;
  readonly onPick: (index: number) => void;
  /** Where the menu renders: the slot above the dock, inside the player root. */
  readonly slot: HTMLElement;
}

/**
 * The glass menu of skill matches above the dock, styled like `RadioMenu`'s popup. Focus never leaves the text box:
 * it owns the keyboard and announces the active option, and a pointer picks without taking focus. It is never taller
 * than the room between the player root's top and the slot; past that its options scroll, keeping the active one in
 * view.
 */
export function SkillMenu({
  id,
  optionId,
  matches,
  total,
  active,
  onHighlight,
  onPick,
  slot,
}: SkillMenuProps) {
  const { root } = usePlayerInstance();
  const list = useRef<HTMLUListElement>(null);
  const room = useRoomAbove(root, slot);

  // Keeps the active option in view, also when a resize makes the menu shorter.
  useLayoutEffect(() => {
    const el = list.current;
    const option = el?.children[active];
    if (!el || !(option instanceof HTMLElement)) return;
    if (option.offsetTop < el.scrollTop) el.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = option.offsetTop + option.offsetHeight - el.clientHeight;
    }
  }, [active, matches, room]);

  return createPortal(
    <div
      style={room === null ? undefined : { maxHeight: room }}
      className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col rounded-md border border-line/40 bg-subtle/92 p-1.5 shadow-soft backdrop-blur-xl motion-safe:animate-[fc-act-in_var(--duration-ui)_var(--ease-expo)]"
    >
      <div
        aria-hidden
        className="flex shrink-0 justify-between gap-2 px-2.5 pt-2 pb-1.5 font-mono text-[11px] font-medium tracking-[0.05em] text-fg-subtle uppercase"
      >
        <span>Skills</span>
        <span>
          {matches.length} of {total}
        </span>
      </div>
      <ul
        ref={list}
        id={id}
        role="listbox"
        aria-label="Skills"
        className="relative min-h-0 overflow-y-auto overscroll-contain"
      >
        {matches.map((match, index) => (
          <li
            key={`${index}-${match.skill.name}`}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            onPointerDown={(event) => {
              // Keep focus, and the caret, in the text box.
              event.preventDefault();
              onPick(index);
            }}
            onPointerMove={() => onHighlight(index)}
            className={`group grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2.5 rounded-sm px-2.5 py-2 select-none ${index === active ? 'bg-overlay/70' : ''}`}
          >
            <span
              className={`font-mono text-[13px] ${index === active ? 'text-violet' : 'text-fg'}`}
            >
              /{highlighted(match)}
            </span>
            <span className="truncate text-[13px] text-fg-subtle">{match.skill.description}</span>
          </li>
        ))}
      </ul>
    </div>,
    slot,
  );
}

/** The name with its matched characters marked. */
const highlighted = ({ skill, positions }: SkillMatch): ReactNode => {
  const marked = new Set(positions);
  return Array.from(skill.name, (char, at) =>
    marked.has(at) ? (
      <mark key={at} className="bg-transparent text-violet underline underline-offset-3">
        {char}
      </mark>
    ) : (
      char
    ),
  );
};

/** Gap between the player root's top edge and the menu. */
const topGap = 8;

/**
 * The height between the player root's top and `slot` (less a small gap), followed as the root resizes or the dock
 * below the slot changes height. `null` until measured.
 */
const useRoomAbove = (root: HTMLElement, slot: HTMLElement): number | null => {
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () =>
      setRoom(
        Math.max(0, slot.getBoundingClientRect().top - root.getBoundingClientRect().top - topGap),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    // The slot's parent holds the dock: it changes height as the text box grows.
    if (slot.parentElement) observer.observe(slot.parentElement);
    return () => observer.disconnect();
  }, [root, slot]);
  return room;
};
