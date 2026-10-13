// The frame loop shared by the two orb mocks: energy followers, integrated flow and spin, breathing and twist.
// Each orb supplies its tuning table and the uniforms it draws with.
import { follow } from './analysis';
import {
  createProgram,
  createTransition,
  resizeCanvas,
  TAU,
  type GL,
  type RendererFactory,
  type RendererInputs,
} from './engine';

/** Orb radius in normalised canvas units; the canvas is `--orb / ORB_RADIUS` across. Keep in sync with the CSS. */
export const ORB_RADIUS = 0.56;

export interface OrbTuning extends Record<string, number | readonly number[]> {
  flow: number;
  breathAmp: number;
  breathPeriod: number;
  twist: number;
  gain: number;
}

export interface OrbFrame {
  readonly now: number;
  readonly flowT: number;
  readonly spin: number;
  readonly twist: number;
  readonly breath: number;
  /** Fast energy, already reduced under reduced motion. */
  readonly energy: number;
  /** Slow energy, already reduced under reduced motion. */
  readonly energySlow: number;
}

export interface OrbSpec<T extends OrbTuning> {
  readonly tag: string;
  readonly vertexShader: string;
  readonly fragmentShader: string;
  readonly targetFor: (inputs: RendererInputs) => T;
  /** Resolves uniform locations once, and returns the per-frame upload. */
  readonly bind: (
    gl: GL,
    uniform: (name: string) => WebGLUniformLocation | null,
  ) => (cur: T, frame: OrbFrame) => void;
}

export const createOrbRenderer =
  <T extends OrbTuning>(spec: OrbSpec<T>): RendererFactory =>
  (canvas, initial) => {
    const program = createProgram(canvas, spec.vertexShader, spec.fragmentShader, spec.tag);
    if (!program) return null;
    const { gl, uniform } = program;
    const upload = spec.bind(gl, uniform);
    const uRes = uniform('uRes');
    const uTime = uniform('uTime');
    const uRadius = uniform('uRadius');

    let inputs = initial;
    const tuning = createTransition(spec.targetFor(initial));
    let last = -1;
    let energy = 0;
    let energySlow = 0;
    let flowT = 0;
    let spin = 0;
    let breathPhase = 0;

    return {
      retarget(next, now) {
        inputs = next;
        tuning.retarget(spec.targetFor(next), now);
      },
      draw(now, analysis) {
        const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        const cur = tuning.at(now);
        const reduced = inputs.reducedMotion;
        const raw = analysis.raw * cur.gain;
        // Attack ~40 ms, release ~200 ms: the orbs answer syllables faster than the band does.
        energy = follow(energy, raw, dt, 0.04, 0.2);
        energySlow += (energy - energySlow) * (1 - Math.exp(-dt / 0.35));

        flowT += dt * (cur.flow + energy * (reduced ? 0.04 : 0.85));
        spin +=
          dt * ((0.04 + cur.flow * 0.07) * (reduced ? 0.15 : 1) + energySlow * (reduced ? 0 : 0.3));
        breathPhase += (dt * TAU) / cur.breathPeriod;
        const breath = Math.sin(breathPhase) * cur.breathAmp;
        const twist = cur.twist * Math.sin(now * 0.00055) + (reduced ? 0 : energySlow * 1.2);

        resizeCanvas(canvas);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uRes, canvas.width, canvas.height);
        gl.uniform1f(uTime, (now / 1000) % 1000);
        gl.uniform1f(uRadius, ORB_RADIUS);
        upload(cur, {
          now,
          flowT,
          spin,
          twist,
          breath,
          energy: reduced ? energy * 0.45 : energy,
          energySlow: reduced ? energySlow * 0.45 : energySlow,
        });
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
  };
