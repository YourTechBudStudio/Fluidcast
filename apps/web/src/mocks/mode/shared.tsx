import { LoaderCircle } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { useReducedMotion } from '../../ui';
import { createAnalysis, DEFAULT_VISUAL, Visual, type VisualState } from '../../visuals';

/** A fake voice for the mocks: syllable-like bursts over a speech-shaped spectrum. */
const syntheticVoice = {
  sample(now: number, out: Float32Array) {
    const t = now / 1000;
    const level = Math.max(0, Math.sin(t * 9.1) * 0.5 + Math.sin(t * 3.7) * 0.35 + 0.15) ** 1.4;
    for (let i = 0; i < out.length; i++) {
      const shape = Math.exp(-(((i - 14) / 9) ** 2)) + 0.4 * Math.exp(-(((i - 30) / 6) ** 2));
      out[i] = Math.min(1, level * shape * (0.8 + 0.2 * Math.sin(t * 13 + i)));
    }
    return Math.min(1, level);
  },
};

/** The player's real visual. It thinks while a start is pending; `voice` feeds it a fake voice while speaking. */
export function StageVisual({
  state,
  voice = false,
  className = '',
}: {
  readonly state: VisualState;
  readonly voice?: boolean;
  readonly className?: string;
}) {
  const analysis = useMemo(() => createAnalysis(), []);
  useEffect(() => {
    analysis.connect(voice ? syntheticVoice : null);
  }, [analysis, voice]);
  const reducedMotion = useReducedMotion();
  const inputs = useMemo(
    () => ({ state, analysis, reducedMotion, held: false }),
    [state, analysis, reducedMotion],
  );
  return (
    <div className={`relative w-full ${className}`}>
      <Visual id={DEFAULT_VISUAL} inputs={inputs} active />
    </div>
  );
}

export function Brand() {
  return (
    <div className="inline-flex items-center gap-2.5 font-display text-[15px] font-medium tracking-[-0.01em] text-fg-muted">
      <i
        aria-hidden
        className="size-2 rounded-full bg-linear-135 from-cyan to-violet shadow-[0_0_12px_rgb(145_215_227/0.5)]"
      />
      Fluidcast
    </div>
  );
}

export function Spinner({ size = 16 }: { readonly size?: number }) {
  return (
    <LoaderCircle
      size={size}
      strokeWidth={2}
      aria-hidden
      className="animate-spin motion-reduce:animate-none"
    />
  );
}

/** A one-line error with a red dot, in the status line's voice. */
export function ErrorLine({
  id,
  text,
  className = '',
}: {
  readonly id?: string;
  readonly text: string;
  readonly className?: string;
}) {
  return (
    <p
      id={id}
      role="alert"
      className={`flex animate-[status-in_var(--duration-surface)_var(--ease-expo)] items-start gap-2 text-[14px] leading-snug text-red ${className}`}
    >
      <i
        aria-hidden
        className="mt-[7px] size-1.5 shrink-0 rounded-full bg-red shadow-[0_0_8px_var(--color-red)]"
      />
      {text}
    </p>
  );
}
