import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { DURATION, EASE_EXPO, Swap, useMeasuredHeight, useReducedMotion } from '../ui';

/** Which shape the dock takes: the composer, or a question (open or answered). */
export type DockShape = 'composer' | 'ask';

const SHAPE = {
  composer: {
    maxWidth: 680,
    borderRadius: 20,
    borderColor: 'rgb(91 96 120 / 0.42)',
    backgroundColor: 'rgb(54 58 79 / 0.42)',
  },
  ask: {
    maxWidth: 880,
    borderRadius: 28,
    borderColor: 'rgb(145 215 227 / 0.24)',
    backgroundColor: 'rgb(54 58 79 / 0.5)',
  },
} as const;

/**
 * One surface that is the composer, the open question and the sent answer in turn. Width, height, radius, edge colour
 * and background glide between shapes as real layout, not a transform, so the Show panel and the orb above follow it
 * frame by frame and text never stretches; the contents crossfade. A cyan light line fades in along the top edge
 * while a question is up. Reduced motion changes shape at once and only fades the contents.
 */
export function Dock({
  shape,
  contentKey,
  children,
}: {
  readonly shape: DockShape;
  readonly contentKey: string;
  readonly children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [inner, height] = useMeasuredHeight();
  const asking = shape === 'ask';
  const glide = reduced ? { duration: 0 } : { duration: DURATION.room, ease: EASE_EXPO };
  return (
    <motion.div
      initial={false}
      animate={{ height, ...SHAPE[shape] }}
      transition={glide}
      className={`relative mx-auto w-full overflow-hidden border shadow-soft backdrop-blur-xl backdrop-saturate-130 ${asking ? '' : 'has-[textarea:focus]:border-blue/45!'}`}
    >
      <motion.span
        aria-hidden
        initial={false}
        animate={{ opacity: asking ? 1 : 0, scaleX: asking || reduced ? 1 : 0.4 }}
        transition={reduced ? { duration: DURATION.surface, ease: EASE_EXPO } : glide}
        className="pointer-events-none absolute inset-x-12 top-0 z-10 h-px bg-linear-to-r from-transparent via-cyan/80 to-transparent"
      />
      <div ref={inner} className="relative">
        <Swap contentKey={contentKey}>{children}</Swap>
      </div>
    </motion.div>
  );
}
