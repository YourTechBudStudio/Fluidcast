import type { VisualId } from './catalog';

/** A small, static preview of a visual for pickers: no tile, just the shape in its idle colours. */
export function VisualSwatch({ id }: { readonly id: VisualId }) {
  if (id === 'electric-spectrum') {
    return (
      <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden className="shrink-0">
        <defs>
          <linearGradient id="swatch-band" x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-cyan)" stopOpacity="0" />
            <stop offset=".3" stopColor="var(--color-cyan)" />
            <stop offset=".6" stopColor="var(--color-blue)" />
            <stop offset=".85" stopColor="var(--color-violet)" />
            <stop offset="1" stopColor="var(--color-violet)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M2 11 C 9 11, 11 6, 17 11 S 26 15, 32 11"
          fill="none"
          stroke="url(#swatch-band)"
          strokeWidth="1.4"
        />
        <path
          d="M2 11 C 9 11, 12 15, 17 11 S 25 7, 32 11"
          fill="none"
          stroke="url(#swatch-band)"
          strokeWidth="1.1"
          opacity=".6"
        />
      </svg>
    );
  }
  if (id === 'orb-mixing') {
    return (
      <span aria-hidden className="grid h-[22px] w-[34px] shrink-0 place-items-center">
        <span className="size-4 rounded-full bg-[conic-gradient(from_40deg,var(--color-cyan),var(--color-blue),var(--color-violet),var(--color-cyan))] blur-[1px]" />
      </span>
    );
  }
  return (
    <span aria-hidden className="grid h-[22px] w-[34px] shrink-0 place-items-center">
      <span className="size-4 rounded-full bg-[radial-gradient(circle_at_35%_30%,rgb(255_255_255/0.7),rgb(138_173_244/0.35)_40%,rgb(36_39_58/0.2)_70%)] shadow-[inset_0_0_0_1px_rgb(202_211_245/0.35)]" />
    </span>
  );
}
