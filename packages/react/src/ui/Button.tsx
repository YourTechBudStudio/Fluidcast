import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

export type ButtonTone = 'primary' | 'quiet' | 'danger' | 'ghost';

const tones: Record<ButtonTone, string> = {
  primary:
    'font-semibold bg-blue text-scrim shadow-[0_6px_20px_rgb(138_173_244/0.22)] hover:bg-[#9dbbf6]',
  quiet:
    'font-semibold bg-elevated/90 text-fg shadow-[inset_0_0_0_1px_rgb(91_96_120/0.7)] hover:bg-overlay',
  danger:
    'font-semibold bg-red/15 text-red shadow-[inset_0_0_0_1px_rgb(237_135_150/0.4)] hover:bg-red/20',
  ghost:
    'text-fg-muted hover:bg-elevated/45 hover:text-fg aria-pressed:bg-elevated/70 aria-pressed:text-fg',
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  readonly tone: ButtonTone;
  readonly icon?: ReactNode;
  /** Disabled buttons stay focusable and announce themselves; clicks are ignored. */
  readonly unavailable?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}

/** The player's one button. Hit area is at least 44 px in every tone. */
export function Button({
  tone,
  icon,
  unavailable = false,
  className = '',
  children,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      aria-disabled={unavailable || undefined}
      onClick={unavailable ? undefined : onClick}
      className={`inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md px-3.5 text-[15px] transition-[background-color,color,opacity] duration-(--duration-surface) ease-expo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue aria-disabled:cursor-default aria-disabled:opacity-45 ${tones[tone]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
