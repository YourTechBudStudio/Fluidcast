import { Play } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { roomTransition } from '../ui';

/**
 * A tap over the visual, used two ways: "Tap to resume" when the browser blocked autoplay after a reload mid-turn (the
 * tap is the gesture that unblocks it), and "Tap to start" when a preloaded start waits to be sent. While
 * `unavailable` it stays visible but ignores taps.
 */
export function TapToResume({
  visible,
  label,
  onActivate,
  unavailable = false,
}: {
  readonly visible: boolean;
  readonly label: string;
  readonly onActivate: () => void;
  readonly unavailable?: boolean;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          aria-disabled={unavailable || undefined}
          onClick={unavailable ? undefined : onActivate}
          className="absolute top-1/2 left-1/2 z-10 inline-flex min-h-11 -translate-1/2 cursor-pointer items-center gap-2.5 rounded-xl border border-fg/16 bg-scrim/42 py-2.5 pr-4.5 pl-3.5 text-[15px] font-semibold whitespace-nowrap text-fg shadow-soft backdrop-blur-md backdrop-saturate-140 hover:bg-scrim/58 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-blue aria-disabled:cursor-default aria-disabled:opacity-50"
          initial={{ opacity: 0, scale: 0.96, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.96, filter: 'blur(4px)' }}
          transition={roomTransition}
        >
          <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden />
          {label}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
