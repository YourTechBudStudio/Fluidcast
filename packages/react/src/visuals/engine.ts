import { easeOutExpo, type Rgb } from '../ui';
import type { Analysis, VisualState } from './types';

export const TRANSITION_MS = 600;
export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

type Tunable = Record<string, number | readonly number[]>;

const lerpRecord = <T extends Tunable>(a: T, b: T, k: number): T => {
  const out: Record<string, number | number[]> = {};
  for (const key in b) {
    const from = a[key]!;
    const to = b[key]!;
    out[key] =
      typeof to === 'number'
        ? (from as number) + (to - (from as number)) * k
        : to.map(
            (v, i) => (from as readonly number[])[i]! + (v - (from as readonly number[])[i]!) * k,
          );
  }
  return out as T;
};

/** A set of tuning values that glides to each new target over 600 ms with expo-out, restarting from wherever it is. */
export function createTransition<T extends Tunable>(initial: T) {
  let from = initial;
  let to = initial;
  let current = initial;
  let t0 = 0;
  return {
    retarget(next: T, now: number) {
      from = current;
      to = next;
      t0 = now;
    },
    at(now: number): T {
      current = lerpRecord(from, to, easeOutExpo(clamp((now - t0) / TRANSITION_MS, 0, 1)));
      return current;
    },
  };
}

// ---------- WebGL ----------

export type GL = WebGLRenderingContext | WebGL2RenderingContext;

function compile(gl: GL, type: number, src: string, tag: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const numbered = src
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(3, ' ')}  ${l}`)
      .join('\n');
    console.error(`[${tag}] shader compile failed:\n${gl.getShaderInfoLog(shader)}\n${numbered}`);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const CONTEXT_OPTIONS: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: 'high-performance',
};

/**
 * WebGL2, else WebGL1, with one fullscreen triangle bound to attribute 0 (`aPos`). Both shader dialects are GLSL ES 1.00,
 * which WebGL2 also accepts. Returns `null` when WebGL is unavailable or the program fails, so the caller shows its CSS fallback.
 */
export function createProgram(
  canvas: HTMLCanvasElement,
  vertex: string,
  fragment: string,
  tag: string,
) {
  let gl: GL | null = null;
  let version = 2;
  try {
    gl = canvas.getContext('webgl2', CONTEXT_OPTIONS);
    if (!gl) {
      version = 1;
      gl = canvas.getContext('webgl', CONTEXT_OPTIONS);
    }
  } catch (error) {
    console.error(`[${tag}] WebGL context creation threw:`, error);
    gl = null;
  }
  if (!gl) {
    console.warn(`[${tag}] WebGL unavailable, using CSS fallback`);
    return null;
  }
  const vs = compile(gl, gl.VERTEX_SHADER, vertex, tag);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment, tag);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(`[${tag}] program link failed:\n${gl.getProgramInfoLog(program)}`);
    return null;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  console.info(`[${tag}] WebGL${version} ready`);
  return { gl, program, uniform };
}

export type Program = NonNullable<ReturnType<typeof createProgram>>;

/** Matches the drawing buffer to the canvas's CSS size, with the device pixel ratio capped at 2. */
export function resizeCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/** A running visual. It owns its simulation; the host owns the loop, the canvas and context loss. */
export interface RendererInputs {
  readonly state: VisualState;
  readonly reducedMotion: boolean;
  readonly held: boolean;
}

export interface Renderer {
  /** New state, motion preference or hold. Tuning glides there over 600 ms. */
  retarget(inputs: RendererInputs, now: number): void;
  draw(now: number, analysis: Analysis): void;
}

export type RendererFactory = (
  canvas: HTMLCanvasElement,
  initial: RendererInputs,
) => Renderer | null;
