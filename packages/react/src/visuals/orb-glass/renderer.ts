// Tuning ported from the orb-glass mock: a dark glass sphere with luminous inner currents.
import { rgb, type PaletteName, type Rgb } from '../../ui';
import { mix3 } from '../engine';
import { createOrbRenderer, type OrbTuning } from '../orb';
import type { VisualState } from '../types';
import { fragmentShader, vertexShader } from './shaders';

const c = rgb;
type Tone = PaletteName | Rgb;
const col = (v: Tone): Rgb => (typeof v === 'string' ? c(v) : v);

interface Row {
  A: Tone;
  B: Tone;
  C: Tone;
  flow: number;
  warp: number;
  current: number;
  bright: number;
  halo: number;
  breathAmp: number;
  breathPeriod: number;
  twist: number;
  gain: number;
}

const STATES: Record<VisualState, Row> = {
  idle: {
    A: 'cyan',
    B: 'blue',
    C: 'violet',
    flow: 0.32,
    warp: 0.85,
    current: 0.85,
    bright: 1.0,
    halo: 0.78,
    breathAmp: 1.0,
    breathPeriod: 5.6,
    twist: 0.0,
    gain: 0.6,
  },
  thinking: {
    A: 'violet',
    B: 'blue',
    C: 'cyan',
    flow: 1.05,
    warp: 1.5,
    current: 1.0,
    bright: 1.0,
    halo: 0.85,
    breathAmp: 1.0,
    breathPeriod: 4.2,
    twist: 0.45,
    gain: 0.0,
  },
  speaking: {
    A: 'blue',
    B: 'cyan',
    C: 'violet',
    flow: 0.55,
    warp: 1.0,
    current: 1.0,
    bright: 1.05,
    halo: 0.9,
    breathAmp: 0.6,
    breathPeriod: 5.0,
    twist: 0.0,
    gain: 1.0,
  },
  error: {
    A: 'red',
    B: mix3(c('red'), c('violet'), 0.5),
    C: mix3(c('violet'), c('fg-muted'), 0.4),
    flow: 0.16,
    warp: 0.7,
    current: 0.55,
    bright: 0.72,
    halo: 0.42,
    breathAmp: 0.8,
    breathPeriod: 6.8,
    twist: 0.0,
    gain: 0.0,
  },
  offline: {
    A: 'fg-subtle',
    B: 'line',
    C: 'fg-muted',
    flow: 0.035,
    warp: 0.5,
    current: 0.32,
    bright: 0.45,
    halo: 0.2,
    breathAmp: 0.35,
    breathPeriod: 8.5,
    twist: 0.0,
    gain: 0.0,
  },
};

interface Tuning extends OrbTuning {
  A: Rgb;
  B: Rgb;
  C: Rgb;
  base: Rgb;
  warp: number;
  current: number;
  bright: number;
  halo: number;
}

export const createOrbGlassRenderer = createOrbRenderer<Tuning>({
  tag: 'orb-glass',
  vertexShader,
  fragmentShader,
  targetFor({ state, reducedMotion, held }) {
    const s = STATES[state];
    const A = col(s.A);
    const t: Tuning = {
      A,
      B: col(s.B),
      C: col(s.C),
      base: mix3(c('scrim'), A, 0.09),
      flow: s.flow,
      warp: s.warp,
      current: s.current,
      bright: s.bright,
      halo: s.halo,
      breathAmp: s.breathAmp,
      breathPeriod: s.breathPeriod,
      twist: s.twist,
      gain: s.gain,
    };
    if (held) {
      t.bright *= 0.72;
      t.current *= 0.8;
      t.flow *= 0.35;
      t.halo *= 0.7;
      t.gain = 0;
    }
    if (reducedMotion) {
      t.flow *= 0.1;
      t.twist = 0;
      t.breathPeriod = 10;
      t.breathAmp = Math.min(t.breathAmp, 0.8);
    }
    return t;
  },
  bind(gl, uniform) {
    const u = {
      flowT: uniform('uFlowT'),
      spin: uniform('uSpin'),
      twist: uniform('uTwist'),
      energy: uniform('uEnergy'),
      bright: uniform('uBright'),
      current: uniform('uCurrent'),
      warp: uniform('uWarp'),
      halo: uniform('uHalo'),
      breath: uniform('uBreath'),
      colA: uniform('uColA'),
      colB: uniform('uColB'),
      colC: uniform('uColC'),
      base: uniform('uBase'),
    };
    return (cur, f) => {
      gl.uniform1f(u.flowT, f.flowT);
      gl.uniform1f(u.spin, f.spin);
      gl.uniform1f(u.twist, f.twist);
      gl.uniform1f(u.energy, f.energy);
      gl.uniform1f(u.bright, cur.bright);
      gl.uniform1f(u.current, cur.current);
      gl.uniform1f(u.warp, cur.warp);
      gl.uniform1f(u.halo, cur.halo);
      gl.uniform1f(u.breath, f.breath);
      gl.uniform3fv(u.colA, cur.A);
      gl.uniform3fv(u.colB, cur.B);
      gl.uniform3fv(u.colC, cur.C);
      gl.uniform3fv(u.base, cur.base);
    };
  },
});

export const orbGlassFallback = (state: VisualState): readonly [Rgb, Rgb, Rgb] => {
  const s = STATES[state];
  return [col(s.A), col(s.B), col(s.C)];
};
