import { AnimatePresence, motion } from 'motion/react';

import { Chip, roomTransition, useReducedMotion } from '../ui';

export interface SubtitleLine {
  /** Changes whenever a different line should crossfade in. */
  readonly key: string;
  readonly text: string;
  /** `current`: the line being heard. `dim`: a finished or cut line. `you`: your own message, briefly, after sending. */
  readonly tone: 'current' | 'dim' | 'you';
  /** "You", or the speaker's name when more than one speaker is configured. */
  readonly label?: string;
  readonly interrupted?: boolean;
}

const toneClass: Record<SubtitleLine['tone'], string> = {
  current: 'text-fg',
  dim: 'text-fg-subtle',
  you: 'text-fg-muted',
};

/** One spoken line at a time, crossfading between lines. */
export function Subtitle({ line }: { readonly line: SubtitleLine | null }) {
  const reduced = useReducedMotion();
  const enter = reduced ? { opacity: 0 } : { opacity: 0, y: 9, filter: 'blur(6px)' };
  const leave = reduced ? { opacity: 0 } : { opacity: 0, y: -7, filter: 'blur(6px)' };
  return (
    <div
      aria-live="polite"
      className="relative h-[calc(3*1.4em)] w-full max-w-165 font-display text-[clamp(18px,2.2vw,23px)] leading-[1.4] font-light tracking-[-0.01em] max-sm:h-[calc(4*1.4em)]"
    >
      <AnimatePresence initial={false}>
        {line && (
          <motion.div
            key={line.key}
            className="absolute inset-0 flex flex-col items-center gap-2 text-center"
            initial={enter}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={leave}
            transition={roomTransition}
          >
            {(line.label || line.interrupted) && (
              <span className="inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.06em] text-fg-subtle uppercase">
                {line.label}
                {line.interrupted && <Chip tone="amber">Interrupted</Chip>}
              </span>
            )}
            <span
              className={`block max-w-[42ch] text-balance transition-colors duration-(--duration-room) ease-expo ${toneClass[line.tone]}`}
            >
              {line.text}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
