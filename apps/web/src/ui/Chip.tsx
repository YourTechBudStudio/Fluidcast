import type { ReactNode } from 'react';

export type ChipTone = 'blue' | 'amber' | 'red' | 'violet' | 'subtle';

const tones: Record<ChipTone, string> = {
  blue: 'border-blue/35 bg-blue/10 text-blue',
  amber: 'border-amber/35 bg-amber/8 text-amber',
  red: 'border-red/35 bg-red/8 text-red',
  violet: 'border-violet/35 bg-violet/8 text-violet',
  subtle: 'border-line/45 text-fg-subtle',
};

/** A small uppercase status label, such as "Interrupted" or "Now playing". */
export function Chip({
  tone,
  live = false,
  children,
}: {
  readonly tone: ChipTone;
  readonly live?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-px align-[2px] font-mono text-[10.5px] font-medium tracking-[0.05em] whitespace-nowrap uppercase ${tones[tone]}`}
    >
      {live && <i className="size-[5px] rounded-full bg-current shadow-[0_0_8px_currentColor]" />}
      {children}
    </span>
  );
}
