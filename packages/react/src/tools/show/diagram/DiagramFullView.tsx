import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { Button, Chip, surfaceTransition, usePlayerInstance, useReducedMotion } from '../../../ui';
import { FORMAT_TILE } from '../format';
import { FormatIcon } from '../FormatIcon';

const FOCUSABLE = 'button:not([aria-disabled="true"]), [tabindex="0"]';

/**
 * A diagram over the whole player (never the page): its title, ✕ and the viewer it holds. It is modal: focus moves
 * into it and stays there, and Escape closes it. Escape is marked handled, so it does not also interrupt. Narration
 * carries on underneath.
 */
export function DiagramFullView({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const { root } = usePlayerInstance();
  const reduced = useReducedMotion();
  const dialog = useRef<HTMLDivElement>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    el.querySelector<HTMLElement>('[role="group"]')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        latestClose.current();
      } else if (event.key === 'Tab') {
        const focusable = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !el.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !el.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);

  const hidden = reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 };
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={surfaceTransition}
      className="absolute inset-0 z-50 bg-scrim/66 p-3 backdrop-blur-sm compact:p-0"
    >
      <motion.div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`${title}, full view`}
        initial={hidden}
        animate={{ opacity: 1, scale: 1 }}
        exit={hidden}
        transition={surfaceTransition}
        className="flex h-full flex-col overflow-hidden rounded-xl border border-line/40 bg-canvas/97 shadow-soft compact:rounded-none compact:border-0"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line/25 py-2 pr-2 pl-3">
          <span
            className={`grid size-8 shrink-0 place-items-center rounded-sm ${FORMAT_TILE.mermaid}`}
          >
            <FormatIcon format="mermaid" />
          </span>
          <h2 className="min-w-0 truncate font-display text-[16px] font-medium tracking-[-0.01em] text-fg">
            {title}
          </h2>
          <span className="shrink-0">
            <Chip tone="violet">Mermaid</Chip>
          </span>
          <Button
            tone="ghost"
            aria-label="Close full view"
            icon={<X size={17} strokeWidth={1.8} aria-hidden />}
            onClick={onClose}
            className="ml-auto"
          />
        </div>
        {children}
      </motion.div>
    </motion.div>,
    root,
  );
}
