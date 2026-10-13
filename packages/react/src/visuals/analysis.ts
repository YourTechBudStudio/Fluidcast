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

/**
 * A critically damped spring with separate up and down stiffness (rad/s). Unlike `follow`, it eases in as well as out, so a
 * value driven by syllables moves without a kink at each onset. Reaches ~63% of a step in about 2.15 / w seconds.
 */
export interface Spring {
  value: number;
  velocity: number;
}

export const spring = (s: Spring, target: number, dt: number, wUp: number, wDown: number) => {
  const w = target > s.value ? wUp : wDown;
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.velocity += (w * w * (target - s.value) - 2 * w * s.velocity) * h;
    s.value += s.velocity * h;
  }
  return s.value;
};

const SPEC_W_UP = 12; // rad/s: ~0.18 s to 63%, eased, so the shape follows syllables without per-bin flicker
const SPEC_W_DOWN = 5; // rad/s: ~0.4 s release, so the gaps between words still read as gaps

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

      // Four [1,2,1] passes ~ a Gaussian of sigma 1 bin: smooth, but formant peaks stay distinct from one vowel to the next.
      for (let p = 0; p < 2; p++) {
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

/** Per-bin spectrum mapping, calibrated against real speech (`scratch/probes/phase-05/calibrate.mjs`). */
const DB_FLOOR = -82; // dBFS per FFT bin that reads as silence
const DB_CEILING = -8; // dBFS per FFT bin that reads as full

/**
 * Level mapping. The level is the RMS of the last 20 ms in dB, placed within a 30 dB window below the voice's recent peak,
 * so speech that TTS has already compressed still swings from 0 between words to near 1 on stressed syllables, whatever the clip's loudness.
 */
const LEVEL_WINDOW_S = 0.02; // RMS window: short enough to resolve syllables
const LEVEL_RANGE_DB = 30; // dB below the recent peak that map to 0..1
const LEVEL_FLOOR_DB = -60; // RMS below this is silence, however quiet the voice
const PEAK_MIN_DB = -36; // the peak reference never drops below this, so near-silence is not amplified into motion
const PEAK_RELEASE_DB_S = 4; // dB per second the peak reference relaxes after a loud passage

/** Analysis frames kept for output-latency compensation: ~1 s at 60 fps, more than any latency we delay by. */
const HISTORY = 64;
const MAX_LATENCY_S = 0.5;

/**
 * An `AnalysisSource` over a Web Audio `AnalyserNode`: its float spectrum mapped into the 48
 * log-spaced bins (80 Hz to 8 kHz), and a peak-relative dB level from the recent time-domain RMS. Bins narrower than an FFT
 * bin interpolate between FFT bins; wider ones average the FFT bins inside their band. The analyser can
 * appear later (audio unlocks on a gesture), so it is read through `node` each frame.
 *
 * The analyser sees samples before the device plays them (by `baseLatency + outputLatency`: a few ms wired, 150 ms or more over
 * Bluetooth), so each frame is measured now and handed out once that latency has passed, keeping the visuals on what is heard.
 */
export function analyserSource(node: () => AnalyserNode | null): AnalysisSource {
  let fft: Float32Array<ArrayBuffer> | null = null;
  let time: Float32Array<ArrayBuffer> | null = null;
  let bands: { lo: number; hi: number; at: number }[] = [];
  let shape = '';
  const halfStep = (FREQ_MAX / FREQ_MIN) ** (0.5 / (BIN_COUNT - 1));
  let peakDb = PEAK_MIN_DB;
  let last = -1;
  const history = Array.from({ length: HISTORY }, () => ({
    at: -Infinity,
    level: 0,
    bins: new Float32Array(BIN_COUNT),
  }));
  let head = 0;

  const norm = (db: number) => Math.min(1, Math.max(0, (db - DB_FLOOR) / (DB_CEILING - DB_FLOOR)));

  const measure = (analyser: AnalyserNode, now: number) => {
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

    head = (head + 1) % HISTORY;
    const frame = history[head]!;
    frame.at = now;
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
      frame.bins[k] = Number.isFinite(db) ? norm(db) : 0;
    }

    // RMS over the newest samples only; the analyser's buffer is longer than a syllable.
    const n = Math.min(time!.length, Math.round(LEVEL_WINDOW_S * analyser.context.sampleRate));
    let sum = 0;
    for (let i = time!.length - n; i < time!.length; i++) sum += time![i]! * time![i]!;
    const db = 10 * Math.log10(sum / n + 1e-12);
    const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    peakDb = Math.max(PEAK_MIN_DB, db, peakDb - PEAK_RELEASE_DB_S * dt);
    frame.level =
      db < LEVEL_FLOOR_DB
        ? 0
        : Math.min(1, Math.max(0, (db - (peakDb - LEVEL_RANGE_DB)) / LEVEL_RANGE_DB));
  };

  /** The newest frame measured at least `delay` ms ago, or the oldest one kept. */
  const heard = (now: number, delay: number) => {
    for (let i = 0; i < HISTORY; i++) {
      const frame = history[(head - i + HISTORY) % HISTORY]!;
      if (frame.at <= now - delay) return frame;
    }
    return history[(head + 1) % HISTORY]!;
  };

  return {
    sample(now, out) {
      const analyser = node();
      if (!analyser) {
        out.fill(0);
        return 0;
      }
      measure(analyser, now);
      // `outputLatency` is missing in some browsers; fall back to what the context knows.
      const context = analyser.context as AudioContext;
      const latency = Math.min(
        MAX_LATENCY_S,
        (context.baseLatency || 0) + (context.outputLatency || 0),
      );
      const frame = heard(now, latency * 1000);
      out.set(frame.bins);
      return frame.level;
    },
  };
}
