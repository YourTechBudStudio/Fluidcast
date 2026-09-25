import { type Analysis, type AnalysisSource, BIN_COUNT } from './types';

export const FREQ_MIN = 80;
export const FREQ_MAX = 8000;

/** Centre frequency of each log-spaced bin, 80 Hz .. 8 kHz. */
export const BIN_FREQUENCIES: readonly number[] = Array.from(
  { length: BIN_COUNT },
  (_, k) => FREQ_MIN * (FREQ_MAX / FREQ_MIN) ** (k / (BIN_COUNT - 1)),
);

/** One-pole follower with separate attack and release time constants (seconds). Visuals use it on `raw × gain`. */
export const follow = (
  current: number,
  target: number,
  dt: number,
  tauUp: number,
  tauDown: number,
): number => {
  const tau = target > current ? tauUp : tauDown;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
};

const SPEC_W_UP = 6; // rad/s: eased attack (~0.35 s to settle), so the shape glides between syllables
const SPEC_W_DOWN = 2.8; // rad/s: long, soft release (~0.7 s)

function blur121(src: Float32Array, dst: Float32Array) {
  for (let k = 0; k < BIN_COUNT; k++) {
    const l = src[Math.max(0, k - 1)]!;
    const r = src[Math.min(BIN_COUNT - 1, k + 1)]!;
    dst[k] = 0.25 * l + 0.5 * src[k]! + 0.25 * r;
  }
}

export interface AnalysisHandle extends Analysis {
  /** Swaps the raw source. `null` means silence. */
  connect(source: AnalysisSource | null): void;
}

/** The shared analysis from the electric-spectrum mock: the raw level and a smoothed spectrum. Followers live with each visual. */
export function createAnalysis(): AnalysisHandle {
  const rawSpec = new Float32Array(BIN_COUNT);
  const tmpSpec = new Float32Array(BIN_COUNT);
  const spectrum = new Float32Array(BIN_COUNT);
  const velocity = new Float32Array(BIN_COUNT);
  let source: AnalysisSource | null = null;
  let last = -1;

  const handle: AnalysisHandle = {
    raw: 0,
    spectrum,
    connect(next) {
      source = next;
    },
    update(now) {
      if (now === last) return;
      const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      let raw = 0;
      if (source) raw = source.sample(now, rawSpec);
      else rawSpec.fill(0);

      // Eight [1,2,1] passes ~ a Gaussian of sigma 2 bins: one smooth, undulating curve rather than jagged bumps.
      for (let p = 0; p < 4; p++) {
        blur121(rawSpec, tmpSpec);
        blur121(tmpSpec, rawSpec);
      }
      // Critically damped spring per bin: glides toward the target without snapping or overshooting.
      const steps = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / steps;
      for (let k = 0; k < BIN_COUNT; k++) {
        const target = rawSpec[k]!;
        const w = target > spectrum[k]! ? SPEC_W_UP : SPEC_W_DOWN;
        let y = spectrum[k]!;
        let v = velocity[k]!;
        for (let i = 0; i < steps; i++) {
          v += (w * w * (target - y) - 2 * w * v) * h;
          y += v * h;
        }
        if (y < 0) {
          y = 0;
          v = 0;
        }
        spectrum[k] = y;
        velocity[k] = v;
      }

      (handle as { raw: number }).raw = raw;
    },
  };
  return handle;
}

/**
 * Level mapping for real audio, calibrated so speech lands in the range the approved mocks' synthetic voice used
 * (`scratch/probes/phase-05/calibrate.mjs`: median and 90th-percentile level and bins while voiced).
 */
const DB_FLOOR = -82; // dBFS per FFT bin that reads as silence
const DB_CEILING = -8; // dBFS per FFT bin that reads as full
const LEVEL_GAIN = 2.9; // time-domain RMS to the raw 0..1 level

/**
 * An `AnalysisSource` over a Web Audio `AnalyserNode`: its float spectrum mapped into the 48
 * log-spaced bins (80 Hz to 8 kHz), and the time-domain RMS as the raw level. Bins narrower than an FFT
 * bin interpolate between FFT bins; wider ones average the FFT bins inside their band. The analyser can
 * appear later (audio unlocks on a gesture), so it is read through `node` each frame.
 */
export function analyserSource(node: () => AnalyserNode | null): AnalysisSource {
  let fft: Float32Array<ArrayBuffer> | null = null;
  let time: Float32Array<ArrayBuffer> | null = null;
  let bands: { lo: number; hi: number; at: number }[] = [];
  let shape = '';
  const halfStep = (FREQ_MAX / FREQ_MIN) ** (0.5 / (BIN_COUNT - 1));

  const norm = (db: number) => Math.min(1, Math.max(0, (db - DB_FLOOR) / (DB_CEILING - DB_FLOOR)));

  return {
    sample(_now, out) {
      const analyser = node();
      if (!analyser) {
        out.fill(0);
        return 0;
      }
      const key = `${analyser.fftSize}:${analyser.context.sampleRate}`;
      if (key !== shape) {
        shape = key;
        fft = new Float32Array(analyser.frequencyBinCount);
        time = new Float32Array(analyser.fftSize);
        const hz = analyser.context.sampleRate / analyser.fftSize;
        bands = BIN_FREQUENCIES.map((f) => ({
          lo: Math.max(1, Math.ceil(f / halfStep / hz)),
          hi: Math.min(analyser.frequencyBinCount - 1, Math.floor((f * halfStep) / hz)),
          at: f / hz,
        }));
      }
      analyser.getFloatFrequencyData(fft!);
      analyser.getFloatTimeDomainData(time!);

      for (let k = 0; k < BIN_COUNT; k++) {
        const { lo, hi, at } = bands[k]!;
        let db: number;
        if (hi < lo) {
          const i = Math.floor(at);
          const t = at - i;
          db = fft![i]! * (1 - t) + fft![i + 1]! * t;
        } else {
          // Average power across the band, then back to dB.
          let power = 0;
          for (let i = lo; i <= hi; i++) power += 10 ** (fft![i]! / 10);
          db = 10 * Math.log10(power / (hi - lo + 1));
        }
        out[k] = Number.isFinite(db) ? norm(db) : 0;
      }

      let sum = 0;
      for (const v of time!) sum += v * v;
      return Math.min(1, Math.sqrt(sum / time!.length) * LEVEL_GAIN);
    },
  };
}
