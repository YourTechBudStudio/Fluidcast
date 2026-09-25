// Tuning ported from the orb-mixing mock: liquid mixing motion (flow, warp, ink, twist) under a glassy finish.
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
  D: Tone;
  flow: number;
  warp: number;
  ink: number;
  accent: number;
  sat: number;
  bright: number;
  core: number;
  halo: number;
  breathAmp: number;
  breathPeriod: number;
  twist: number;
  gain: number;
}

// core: the soft inner light seen through the glass.
const STATES: Record<VisualState, Row> = {
  idle: {
    A: 'cyan',
    B: 'blue',
    C: mix3(c('cyan'), c('green'), 0.75),
    D: 'violet',
    flow: 0.32,
    warp: 0.9,
    ink: 0.35,
    accent: 0.4,
    sat: 1.0,
    bright: 0.95,
    core: 0.6,
    halo: 0.34,
    breathAmp: 1.0,
    breathPeriod: 5.6,
    twist: 0.0,
    gain: 0.6,
  },
  thinking: {
    A: 'violet',
    B: mix3(c('violet'), c('blue'), 0.45),
    C: mix3(c('violet'), c('scrim'), 0.4),
    D: mix3(c('violet'), c('red'), 0.35),
    flow: 0.8,
    warp: 1.45,
    ink: 0.5,
    accent: 0.45,
    sat: 1.0,
    bright: 0.92,
    core: 0.45,
    halo: 0.36,
    breathAmp: 1.0,
    breathPeriod: 4.2,
    twist: 0.45,
    gain: 0.0,
  },
  speaking: {
    A: 'blue',
    B: 'cyan',
    C: 'violet',
    D: 'amber',
    flow: 0.5,
    warp: 1.0,
    ink: 0.28,
    accent: 0.22,
    sat: 1.0,
    bright: 0.9,
    core: 0.6,
    halo: 0.38,
    breathAmp: 0.6,
    breathPeriod: 5.0,
    twist: 0.0,
    gain: 1.0,
  },
  error: {
    A: mix3(c('red'), c('fg-muted'), 0.2),
    B: mix3(c('red'), c('violet'), 0.5),
    C: mix3(c('violet'), c('fg-muted'), 0.4),
    D: mix3(c('red'), c('amber'), 0.45),
    flow: 0.14,
    warp: 0.75,
    ink: 0.4,
    accent: 0.3,
    sat: 0.72,
    bright: 0.78,
    core: 0.3,
    halo: 0.19,
    breathAmp: 0.8,
    breathPeriod: 6.8,
    twist: 0.0,
    gain: 0.0,
  },
  offline: {
    A: 'fg-subtle',
    B: 'line',
    C: 'fg-muted',
    D: 'fg-subtle',
    flow: 0.035,
    warp: 0.6,
    ink: 0.2,
    accent: 0.0,
    sat: 0.15,
    bright: 0.72,
    core: 0.15,
    halo: 0.09,
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
  D: Rgb;
  base: Rgb;
  warp: number;
  ink: number;
  accent: number;
  sat: number;
  bright: number;
  core: number;
  halo: number;
}

export const createOrbMixingRenderer = createOrbRenderer<Tuning>({
  tag: 'orb-mixing',
  vertexShader,
  fragmentShader,
  targetFor({ state, reducedMotion, held }) {
    const s = STATES[state];
    const A = col(s.A);
    const t: Tuning = {
      A,
      B: col(s.B),
      C: col(s.C),
      D: col(s.D),
      base: mix3(c('scrim'), A, 0.16),
      flow: s.flow,
      warp: s.warp,
      ink: s.ink,
      accent: s.accent,
      sat: s.sat,
      bright: s.bright,
      core: s.core,
      halo: s.halo,
      breathAmp: s.breathAmp,
      breathPeriod: s.breathPeriod,
      twist: s.twist,
      gain: s.gain,
    };
    if (held) {
      t.bright *= 0.72;
      t.sat *= 0.8;
      t.core *= 0.7;
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
      energySlow: uniform('uEnergySlow'),
      bright: uniform('uBright'),
      ink: uniform('uInk'),
      warp: uniform('uWarp'),
      sat: uniform('uSat'),
      accent: uniform('uAccent'),
      halo: uniform('uHalo'),
      core: uniform('uCore'),
      breath: uniform('uBreath'),
      colA: uniform('uColA'),
      colB: uniform('uColB'),
      colC: uniform('uColC'),
      colD: uniform('uColD'),
      base: uniform('uBase'),
    };
    return (cur, f) => {
      gl.uniform1f(u.flowT, f.flowT);
      gl.uniform1f(u.spin, f.spin);
      gl.uniform1f(u.twist, f.twist);
      gl.uniform1f(u.energy, f.energy);
      gl.uniform1f(u.energySlow, f.energySlow);
      gl.uniform1f(u.bright, cur.bright);
      gl.uniform1f(u.ink, cur.ink);
      gl.uniform1f(u.warp, cur.warp);
      gl.uniform1f(u.sat, cur.sat);
      gl.uniform1f(u.accent, cur.accent);
      gl.uniform1f(u.halo, cur.halo);
      gl.uniform1f(u.core, cur.core);
      gl.uniform1f(u.breath, f.breath);
      gl.uniform3fv(u.colA, cur.A);
      gl.uniform3fv(u.colB, cur.B);
      gl.uniform3fv(u.colC, cur.C);
      gl.uniform3fv(u.colD, cur.D);
      gl.uniform3fv(u.base, cur.base);
    };
  },
});

/** Fallback gradient colours per state (the first three tones). */
export const orbMixingFallback = (state: VisualState): readonly [Rgb, Rgb, Rgb] => {
  const s = STATES[state];
  return [col(s.A), col(s.B), col(s.C)];
};
