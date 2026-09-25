import { Play } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { roomTransition } from '../ui';

/** Shown over the visual when the browser blocked autoplay after a reload mid-turn. The tap is the gesture that unblocks it. */
export function TapToResume({
  visible,
  onResume,
}: {
  readonly visible: boolean;
  readonly onResume: () => void;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={onResume}
          className="absolute top-1/2 left-1/2 z-10 inline-flex min-h-11 -translate-1/2 cursor-pointer items-center gap-2.5 rounded-xl border border-fg/16 bg-scrim/42 py-2.5 pr-4.5 pl-3.5 text-[15px] font-semibold whitespace-nowrap text-fg shadow-soft backdrop-blur-md backdrop-saturate-140 hover:bg-scrim/58 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-blue"
          initial={{ opacity: 0, scale: 0.96, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.96, filter: 'blur(4px)' }}
          transition={roomTransition}
        >
          <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden />
          Tap to resume
        </motion.button>
      )}
    </AnimatePresence>
  );
}
