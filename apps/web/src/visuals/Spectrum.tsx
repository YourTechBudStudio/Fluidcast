import { rgb, type PaletteName } from '../ui';
import { GlVisual } from './GlVisual';
import { createSpectrumRenderer } from './spectrum/renderer';
import type { VisualInputs, VisualState } from './types';

const FALLBACK_TONES: Record<VisualState, readonly [PaletteName, PaletteName, PaletteName]> = {
  idle: ['cyan', 'blue', 'green'],
  thinking: ['violet', 'blue', 'violet'],
  speaking: ['blue', 'cyan', 'violet'],
  error: ['red', 'red', 'violet'],
  offline: ['fg-subtle', 'line', 'fg-subtle'],
};

// A few standing lens-shaped strands that flex in place; amplitude per state is set in CSS.
const STRANDS = [
  { a: 60, cyc: 2.8, c: 'var(--fa)', dur: 2.3, delay: 0, ph: 0.0, o: 0.9 },
  { a: 44, cyc: 5.0, c: 'var(--fb)', dur: 1.7, delay: -0.6, ph: 1.2, o: 0.85 },
  { a: 30, cyc: 7.3, c: 'var(--fc)', dur: 1.3, delay: -0.3, ph: 2.1, o: 0.75 },
  { a: 18, cyc: 10.2, c: 'var(--color-fg)', dur: 1.05, delay: -0.8, ph: 0.4, o: 0.5 },
].map((s) => {
  let d = '';
  for (let x = 0; x <= 1000; x += 5) {
    const xn = x / 500 - 1;
    const env = Math.max(0, 1 - xn * xn) ** 1.25;
    const y = 100 + s.a * env * Math.sin(xn * Math.PI * s.cyc + s.ph);
    d += `${x ? 'L' : 'M'}${x} ${y.toFixed(2)}`;
  }
  return { ...s, d };
});

function Fallback({ state, held }: { readonly state: VisualState; readonly held: boolean }) {
  return (
    <div className="visual-fallback spectrum-fallback" data-state={state} data-held={held}>
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spectrum-fb-fade" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".16" stopColor="#fff" stopOpacity=".7" />
            <stop offset=".5" stopColor="#fff" stopOpacity="1" />
            <stop offset=".84" stopColor="#fff" stopOpacity=".7" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask
            id="spectrum-fb-mask"
            maskUnits="userSpaceOnUse"
            x="0"
            y="-200"
            width="1000"
            height="600"
          >
            <rect x="0" y="-200" width="1000" height="600" fill="url(#spectrum-fb-fade)" />
          </mask>
        </defs>
        <g mask="url(#spectrum-fb-mask)">
          <g className="fb-amp">
            {STRANDS.map((s) => (
              <path
                key={s.cyc}
                d={s.d}
                style={{
                  color: s.c,
                  opacity: s.o,
                  ['--dur' as string]: `${s.dur}s`,
                  ['--delay' as string]: `${s.delay}s`,
                }}
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}

export function Spectrum({
  inputs,
  active,
}: {
  readonly inputs: VisualInputs;
  readonly active: boolean;
}) {
  const tones = FALLBACK_TONES[inputs.state];
  return (
    <GlVisual
      tag="spectrum"
      factory={createSpectrumRenderer}
      shape="band"
      inputs={inputs}
      active={active}
      fallbackTones={[rgb(tones[0]), rgb(tones[1]), rgb(tones[2])]}
      fallback={<Fallback state={inputs.state} held={inputs.held} />}
      className="size-full"
    />
  );
}
