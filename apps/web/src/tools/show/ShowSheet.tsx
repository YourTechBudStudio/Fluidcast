import { AnimatePresence, motion } from 'motion/react';

import { surfaceTransition, useReducedMotion } from '../../ui';
import type { ShownShow } from './model';
import { ShowContent } from './ShowContent';
import { ShowHeader } from './ShowHeader';

/**
 * The Show at phone width: a full-width sheet over the top bar and the stage. The layout places it as a grid item
 * spanning those rows, so the dock below stays in place. It slides up from the bottom; reduced motion fades it.
 */
export function ShowSheet({
  show,
  open,
  speaking,
  onClose,
}: {
  readonly show: ShownShow | null;
  readonly open: boolean;
  readonly speaking: boolean;
  readonly onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const hidden = reduced ? { opacity: 0 } : { y: '104%' };
  return (
    <div className="pointer-events-none relative z-30 col-start-1 row-start-1 row-end-3 overflow-hidden">
      <AnimatePresence>
        {open && show && (
          <motion.section
            key="sheet"
            aria-label="Show"
            initial={hidden}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={hidden}
            transition={surfaceTransition}
            className="pointer-events-auto absolute inset-x-0 top-2 bottom-0 flex flex-col overflow-hidden rounded-t-[26px] border border-b-0 border-line/40 bg-[rgb(42_46_65/0.96)] shadow-[0_-12px_40px_rgb(0_0_0/0.35)] backdrop-blur-2xl"
          >
            <ShowHeader
              input={show.input}
              onClose={onClose}
              speaking={speaking}
              className="shrink-0 pt-2.5"
            />
            <div
              aria-hidden
              className="mx-4 h-px shrink-0 bg-linear-to-r from-transparent via-line/45 to-transparent"
            />
            <div className="flex min-h-0 flex-1 flex-col">
              <ShowContent
                key={show.handle}
                input={show.input}
                body={show.body}
                correction={show.correction}
                compact
              />
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
