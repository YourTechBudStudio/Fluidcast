import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';

import { DURATION, EASE_EXPO } from './motion';
import { useReducedMotion } from './useReducedMotion';

/** The old content blurs out quickly; the new one settles in just after. One curve, fixed durations. */
const swap = {
  initial: { opacity: 0, y: 6, filter: 'blur(6px)' },
  animate: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: DURATION.surface, ease: EASE_EXPO, delay: DURATION.micro },
  },
  exit: { opacity: 0, filter: 'blur(6px)', transition: { duration: DURATION.ui, ease: EASE_EXPO } },
} as const;

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATION.surface, ease: EASE_EXPO } },
  exit: { opacity: 0, transition: { duration: DURATION.ui, ease: EASE_EXPO } },
} as const;

/**
 * Crossfades keyed content inside a surface. The leaving content pops out of flow, so a measured parent follows the new
 * content's height. Reduced motion fades only.
 */
export function Swap({
  contentKey,
  children,
}: {
  readonly contentKey: string;
  readonly children: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div key={contentKey} {...(reduced ? fade : swap)}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
