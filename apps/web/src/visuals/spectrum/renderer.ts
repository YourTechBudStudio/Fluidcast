// Simulation and uniforms ported from the electric-spectrum mock. Only the mirrored frequency layout is kept.
import { rgb, type PaletteName, type Rgb } from '../../ui';
import { follow } from '../analysis';
import {
  clamp,
  createProgram,
  createTransition,
  mix3,
  rand,
  resizeCanvas,
  TAU,
  type RendererFactory,
  type RendererInputs,
} from '../engine';
import { BIN_COUNT, type VisualState } from '../types';
import { fragmentShader, vertexShader } from './shaders';

/** Canvas height / band height; the canvas overhangs the band so the bloom has room. Keep in sync with the CSS. */
export const BAND_OVER = 1.4;
const BAND_FRAC = 0.42; // band half-length as a fraction of the canvas width
const SIGMA = 0.28; // Gaussian window, fraction of the band half-length
const FIELD_W = 64;
const FIELD_H = 16;

const c = rgb;
const strandCols = (list: readonly (PaletteName | Rgb)[]) =>
  list.flatMap((v) => (typeof v === 'string' ? c(v) : v));

type Tuning = {
  cols: number[];
  count: number;
  spread: number;
  bright: number;
  crackle: number;
  crkFreq: number;
  crackRate: number;
  spark: number;
  und: number;
  undRate: number;
  jitRate: number;
  kScale: number;
  ripple: number;
  breathAmp: number;
  breathPeriod: number;
  flicker: number;
  baseAmp: number;
  gain: number;
  modeRate: number;
};

// Each state is a target set of uniforms.
const STATES: Record<VisualState, Tuning> = {
  idle: {
    cols: strandCols([
      'cyan',
      mix3(c('cyan'), c('blue'), 0.35),
      mix3(c('cyan'), c('fg'), 0.25),
      mix3(c('cyan'), c('green'), 0.4),
      'cyan',
      mix3(c('cyan'), c('blue'), 0.2),
    ]),
    count: 4,
    spread: 0.05,
    bright: 0.66,
    crackle: 0.25,
    crkFreq: 0.6,
    crackRate: 3,
    spark: 0,
    und: 0.03,
    undRate: 0.35,
    jitRate: 0.4,
    kScale: 0.75,
    ripple: 0,
    breathAmp: 0,
    breathPeriod: 5.6,
    flicker: 0,
    baseAmp: 0.08,
    gain: 0.6,
    modeRate: 0.3,
  },
  thinking: {
    cols: strandCols([
      'violet',
      mix3(c('violet'), c('blue'), 0.4),
      mix3(c('violet'), c('fg'), 0.3),
      mix3(c('violet'), c('blue'), 0.2),
      'violet',
      mix3(c('violet'), c('red'), 0.2),
    ]),
    count: 5,
    spread: 0.05,
    bright: 0.8,
    crackle: 0.25,
    crkFreq: 0.6,
    crackRate: 3,
    spark: 0,
    und: 0.3,
    undRate: 0.8,
    jitRate: 0.6,
    kScale: 0.8,
    ripple: 0,
    breathAmp: 0,
    breathPeriod: 4.2,
    flicker: 0,
    baseAmp: 0.28,
    gain: 0.0,
    modeRate: 0.55,
  },
  speaking: {
    cols: strandCols([
      mix3(c('blue'), c('violet'), 0.55),
      'blue',
      mix3(c('blue'), c('fg'), 0.2),
      mix3(c('blue'), c('cyan'), 0.4),
      'cyan',
      mix3(c('cyan'), c('green'), 0.65),
    ]),
    count: 6,
    spread: 0.035,
    bright: 0.9,
    crackle: 0,
    crkFreq: 0.45,
    crackRate: 2.5,
    spark: 0,
    und: 0.03,
    undRate: 0.5,
    jitRate: 0.5,
    kScale: 0.85,
    ripple: 0,
    breathAmp: 0,
    breathPeriod: 5.0,
    flicker: 0,
    baseAmp: 0.1,
    gain: 1.0,
    modeRate: 0.9,
  },
  error: {
    cols: strandCols(['red', mix3(c('red'), c('violet'), 0.3), 'red', 'red', 'red', 'red']),
    count: 2,
    spread: 0.1,
    bright: 0.5,
    crackle: 0.5,
    crkFreq: 1.0,
    crackRate: 8,
    spark: 0,
    und: 0.03,
    undRate: 0.45,
    jitRate: 0.5,
    kScale: 0.8,
    ripple: 0,
    breathAmp: 0,
    breathPeriod: 6.8,
    flicker: 1,
    baseAmp: 0.05,
    gain: 0.0,
    modeRate: 0.45,
  },
  offline: {
    cols: strandCols(['fg-subtle', 'line', 'fg-subtle', 'fg-subtle', 'fg-subtle', 'fg-subtle']),
    count: 3,
    spread: 0.09,
    bright: 0.32,
    crackle: 0.0,
    crkFreq: 1.0,
    crackRate: 0,
    spark: 0,
    und: 0.004,
    undRate: 0.15,
    jitRate: 0.15,
    kScale: 0.6,
    ripple: 0,
    breathAmp: 0,
    breathPeriod: 8.5,
    flicker: 0,
    baseAmp: 0.01,
    gain: 0.0,
    modeRate: 0.08,
  },
};

function targetFor({ state, reducedMotion, held }: RendererInputs): Tuning {
  const t = { ...STATES[state], cols: STATES[state].cols.slice() };
  if (held) {
    t.bright *= 0.72;
    t.crackle *= 0.5;
    t.crackRate *= 0.4;
    t.spark = 0;
    t.und *= 0.5;
    t.undRate *= 0.4;
    t.jitRate *= 0.4;
    t.gain = 0;
  }
  if (reducedMotion) {
    t.crackle = 0;
    t.crackRate = 0;
    t.spark = 0;
    t.flicker = 0;
    t.undRate *= 0.3;
    t.jitRate *= 0.3;
    t.breathPeriod = 10;
    t.breathAmp = Math.min(t.breathAmp, 0.8);
  }
  return t;
}

// ---------- In-place undulation field: 2D gradient noise over (x, time). The pattern morphs where it is and never drifts. ----------
function hashGrad(ix: number, iy: number): [number, number] {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  const a = ((h >>> 0) / 4294967296) * TAU;
  return [Math.cos(a), Math.sin(a)];
}
function gnoise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const g = (ox: number, oy: number) => {
    const h = hashGrad(ix + ox, iy + oy);
    return h[0] * (fx - ox) + h[1] * (fy - oy);
  };
  const a = g(0, 0) + (g(1, 0) - g(0, 0)) * ux;
  const b = g(0, 1) + (g(1, 1) - g(0, 1)) * ux;
  return a + (b - a) * uy; // roughly -0.7..0.7
}

function makeTex(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  unit: number,
  w: number,
  h: number,
  data: Uint8Array,
) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
  return tex;
}

// Each strand mixes two standing modes whose time phases advance at per-strand base speeds, scaled by the state's rate and the voice level,
// and nudged by smooth noise so the motion never repeats. cos() of each phase goes to the shader; nothing travels sideways.
const MODE_W = Array.from(
  { length: 6 },
  (_, i) => [TAU * (0.42 + 0.11 * i), TAU * (0.83 + 0.17 * i)] as const,
); // rad/s at rate 1

export const createSpectrumRenderer: RendererFactory = (canvas, initial) => {
  const program = createProgram(canvas, vertexShader, fragmentShader, 'spectrum');
  if (!program) return null;
  const { gl, uniform } = program;

  const specBytes = new Uint8Array(BIN_COUNT);
  const field = new Uint8Array(FIELD_W * FIELD_H);
  // LUMINANCE/UNSIGNED_BYTE with CLAMP_TO_EDGE and no mipmaps: valid for NPOT sizes in WebGL1 and WebGL2.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const specTex = makeTex(gl, 0, BIN_COUNT, 1, specBytes);
  const fieldTex = makeTex(gl, 1, FIELD_W, FIELD_H, field);
  const u = {
    res: uniform('uRes'),
    time: uniform('uTime'),
    unit: uniform('uUnit'),
    dpr: uniform('uDpr'),
    halfLen: uniform('uHalfLen'),
    spec: uniform('uSpec'),
    field: uniform('uField'),
    mirror: uniform('uMirror'),
    gain: uniform('uGain'),
    col: uniform('uCol[0]'),
    sigma: uniform('uSigma'),
    phase: uniform('uPhase'),
    crkFreq: uniform('uCrkFreq'),
    count: uniform('uCount'),
    spread: uniform('uSpread'),
    bright: uniform('uBright'),
    crackle: uniform('uCrackle'),
    crackT: uniform('uCrackT'),
    spark: uniform('uSpark'),
    und: uniform('uUnd'),
    kScale: uniform('uKScale'),
    ripple: uniform('uRipple'),
    breath: uniform('uBreath'),
    flicker: uniform('uFlicker'),
    baseAmp: uniform('uBaseAmp'),
    mode: uniform('uMode[0]'),
    energy: uniform('uEnergy'),
  };
  gl.uniform1i(u.spec, 0);
  gl.uniform1i(u.field, 1);

  let inputs = initial;
  const tuning = createTransition(targetFor(initial));

  // ---------- Swells: occasional local bulges while thinking ----------
  const swells: { x: number; w: number; a: number; t0: number; dur: number }[] = [];
  let nextSwell = 0;
  let cur = tuning.at(0);
  function updateSwells(now: number) {
    for (let i = swells.length - 1; i >= 0; i--)
      if (now - swells[i]!.t0 > swells[i]!.dur) swells.splice(i, 1);
    if (cur.und > 0.02 && !inputs.reducedMotion && now > nextSwell) {
      swells.push({
        x: rand(-0.55, 0.55),
        w: rand(0.14, 0.3),
        a: rand(0.3, 0.6),
        t0: now,
        dur: rand(1100, 2100),
      });
      nextSwell = now + rand(1400, 4200);
    }
  }
  function swellAt(xn: number, now: number) {
    let v = 0;
    for (const s of swells) {
      const b = Math.sin((Math.PI * (now - s.t0)) / s.dur);
      const d = (xn - s.x) / s.w;
      v += s.a * b * b * Math.exp(-d * d);
    }
    return v;
  }
  function writeField(undT: number, jitT: number, now: number) {
    for (let i = 0; i < 6; i++) {
      const wob = 0.75 + 0.35 * gnoise(i * 4.1 + 0.5, undT * 0.35); // each strand swells and settles on its own
      const sw = 0.85 + 0.15 * Math.sin(i * 2.1);
      for (let col = 0; col < FIELD_W; col++) {
        const xn = (col / (FIELD_W - 1)) * 2 - 1;
        const n =
          0.55 * gnoise(xn * 1.6 + i * 1.7, undT * 0.21) +
          0.3 * gnoise(xn * 3.4 - i * 2.3, undT * 0.47 + 5.1) +
          0.15 * gnoise(xn * 7.0 + i * 0.7, undT * 0.93 + 9.7);
        const a = clamp(0.5 + 1.1 * n, 0.06, 1) * wob + swellAt(xn, now) * sw;
        field[(1 + i) * FIELD_W + col] = Math.round(clamp(a / 1.5, 0, 1) * 255);
        const j =
          gnoise(xn * 1.2 + i * 3.3, jitT * 0.3 + i * 1.3) +
          0.45 * gnoise(xn * 2.7 - i * 1.1, jitT * 0.71 + 7.7);
        field[(7 + i) * FIELD_W + col] = Math.round(clamp(j / 3 + 0.5, 0, 1) * 255);
      }
    }
  }

  const modeTheta = Array.from({ length: 12 }, () => rand(0, TAU));
  const modeArr = new Float32Array(18);
  let modeClock = rand(0, 100);
  function updateModes(dt: number, level: number) {
    const rate = cur.modeRate * (inputs.reducedMotion ? 0.35 : 1) * (1 + 0.8 * level);
    modeClock += dt;
    for (let i = 0; i < 6; i++) {
      for (let m = 0; m < 2; m++) {
        const wander = 1 + 0.45 * gnoise(i * 3.7 + m * 11.1, modeClock * 0.35 + i * 1.9);
        modeTheta[i * 2 + m] =
          (modeTheta[i * 2 + m]! + dt * MODE_W[i]![m]! * rate * wander) % (TAU * 1000);
        modeArr[i * 3 + m] = Math.cos(modeTheta[i * 2 + m]!);
      }
      modeArr[i * 3 + 2] = clamp(
        0.8 + 0.55 * gnoise(i * 5.3 + 2.2, modeClock * 0.45 * (0.5 + rate)),
        0.45,
        1.15,
      ); // each strand breathes on its own
    }
  }

  let last = -1;
  let energy = 0;
  let level = 0;
  let breathPhase = 0;
  let crackT = 0;
  let undT = rand(0, 50);
  let jitT = rand(0, 50);

  return {
    retarget(next, now) {
      inputs = next;
      tuning.retarget(targetFor(next), now);
    },
    draw(now, analysis) {
      const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      cur = tuning.at(now);
      // As in the mock, gain scales the raw level before the followers, so the band fades out smoothly when the audio stops.
      const raw = analysis.raw * cur.gain;
      // Attack ~90 ms, release ~360 ms: follows syllables through a smooth curve.
      energy = follow(energy, raw, dt, 0.09, 0.36);
      // Slow level for displacement and wave speed: swells over phrases rather than pumping on every syllable.
      level = follow(level, energy, dt, 0.28, 0.65);
      for (let k = 0; k < BIN_COUNT; k++)
        specBytes[k] = Math.round(clamp(analysis.spectrum[k]!, 0, 1) * 255);

      undT += dt * cur.undRate;
      jitT += dt * cur.jitRate * (1 + (inputs.reducedMotion ? 0 : 0.5 * energy));
      const sharedPhase = 0.6 * gnoise(3.3, undT * 0.22) + 0.35 * gnoise(7.1, jitT * 0.3);
      updateSwells(now);
      writeField(undT, jitT, now);
      updateModes(dt, level);
      breathPhase += (dt * TAU) / cur.breathPeriod;
      const breath = Math.sin(breathPhase) * cur.breathAmp;
      crackT = (crackT + dt * cur.crackRate) % 1000;

      resizeCanvas(canvas);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, specTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        BIN_COUNT,
        1,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        specBytes,
      );
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        FIELD_W,
        FIELD_H,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        field,
      );
      const unit = canvas.height / (2 * BAND_OVER);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, (now / 1000) % 1000);
      gl.uniform1f(u.unit, unit);
      gl.uniform1f(u.dpr, canvas.width / Math.max(1, canvas.clientWidth));
      gl.uniform1f(u.halfLen, (BAND_FRAC * canvas.width) / unit);
      gl.uniform1f(u.mirror, 1);
      gl.uniform1f(u.gain, cur.gain * (inputs.reducedMotion ? 0.6 : 1));
      gl.uniform3fv(u.col, cur.cols);
      gl.uniform1f(u.count, cur.count);
      gl.uniform1f(u.spread, cur.spread);
      gl.uniform1f(u.bright, cur.bright * (1 + 0.08 * energy));
      gl.uniform1f(u.crackle, cur.crackle);
      gl.uniform1f(u.crackT, crackT);
      gl.uniform1f(u.spark, cur.spark);
      gl.uniform1f(u.und, cur.und);
      gl.uniform1f(u.kScale, cur.kScale);
      gl.uniform1f(u.ripple, cur.ripple);
      gl.uniform1f(u.breath, breath);
      gl.uniform1f(u.flicker, cur.flicker);
      gl.uniform1f(u.baseAmp, cur.baseAmp);
      gl.uniform1f(u.sigma, SIGMA);
      gl.uniform1f(u.phase, sharedPhase);
      gl.uniform1f(u.crkFreq, cur.crkFreq);
      gl.uniform3fv(u.mode, modeArr);
      gl.uniform1f(u.energy, level);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
};
