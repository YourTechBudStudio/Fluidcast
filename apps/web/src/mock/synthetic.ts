// The mocks' synthetic voice, kept only until phase 5 feeds real audio. It builds a syllable timeline from a line's text and
// synthesises the level and log-spectrum a voice would have: formant bumps per syllable, fricative and plosive bursts, silence in pauses.
import { type AnalysisSource, BIN_COUNT, BIN_FREQUENCIES } from '../visuals';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
type Triple = readonly [number, number, number];
const mix3 = (a: Triple, b: Triple, t: number): Triple => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const gauss = (d: number, s: number) => Math.exp(-(d * d) / (2 * s * s));

const BIN_L = BIN_FREQUENCIES.map((f) => Math.log2(f));
const shape = (fn: (l: number) => number) => Float32Array.from(BIN_L, fn);

// Rough adult formants F1/F2/F3 (Hz) keyed by the written vowel.
const VOWELS: Record<string, Triple> = {
  a: [730, 1250, 2550],
  e: [530, 1840, 2480],
  i: [300, 2250, 2950],
  o: [520, 900, 2450],
  u: [330, 950, 2350],
  y: [420, 1950, 2600],
  '@': [500, 1480, 2500],
};
const FORMANT_GAIN = [1.0, 0.72, 0.45];
const FORMANT_BW = [0.3, 0.26, 0.22]; // octaves

type Burst = 's' | 'sh' | 'f' | 'p';
const BURST: Record<Burst, Float32Array> = {
  s: shape((l) => 0.95 * gauss(l - Math.log2(6300), 0.5) + 0.3 * gauss(l - Math.log2(3600), 0.55)),
  sh: shape((l) => 0.85 * gauss(l - Math.log2(3000), 0.5) + 0.4 * gauss(l - Math.log2(5400), 0.6)),
  f: shape((l) => 0.55 * gauss(l - Math.log2(4600), 1.1)),
  p: shape((l) => 0.3 + 0.3 * gauss(l - Math.log2(1800), 1.0)),
};

function voicedInto(out: Float32Array, F: Triple, F0: number, w: number) {
  const lF0 = Math.log2(F0);
  const lF = F.map((f) => Math.log2(f));
  for (let k = 0; k < BIN_COUNT; k++) {
    const f = BIN_FREQUENCIES[k]!;
    const l = BIN_L[k]!;
    const src = f < F0 ? gauss(l - lF0, 0.5) : (F0 / f) ** 0.5; // glottal source: strong at F0, rolls off below, tilts down above
    let form = 0;
    for (let j = 0; j < 3; j++) form += FORMANT_GAIN[j]! * gauss(l - lF[j]!, FORMANT_BW[j]!);
    out[k] = Math.max(out[k]!, (0.62 * src + 0.66 * form) * w);
  }
}

function burstInto(out: Float32Array, sh: Float32Array, w: number) {
  for (let k = 0; k < BIN_COUNT; k++) out[k] = Math.max(out[k]!, sh[k]! * w);
}

function classify(seg: string, nextVowel: string): Burst | null {
  if (!seg) return null;
  if (/sh|ch/.test(seg)) return 'sh';
  if (/th|f|v/.test(seg)) return 'f';
  if (/[szx]/.test(seg)) return 's';
  if (/c$/.test(seg) && /^[eiy]/.test(nextVowel)) return 's';
  if (/[ptkbdgqc]/.test(seg)) return 'p';
  return null; // nasals, liquids, glides: voiced, no burst
}

function countSyllables(word: string) {
  const s = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return 0;
  const m = s.match(/[aeiouy]+/g);
  let n = m ? m.length : 1;
  if (n > 1 && s.length > 3 && /e$/.test(s) && !/le$/.test(s)) n--;
  return clamp(n, 1, 4);
}

interface Syllable {
  t: number;
  dur: number;
  amp: number;
  F: Triple;
  F0: number;
  onset: Burst | null;
  coda: Burst | null;
}

function buildTimeline(sentence: string) {
  const words = sentence.split(/\s+/).filter(Boolean);
  const syl: Syllable[] = [];
  let t = 0.18;
  const pitch0 = rand(150, 175);
  words.forEach((w, wi) => {
    const n = countSyllables(w);
    const lw = w.toLowerCase().replace(/[^a-z]/g, '');
    const groups = lw.match(/[aeiouy]+/g) ?? [];
    const segs = lw.split(/[aeiouy]+/);
    const prog = wi / Math.max(1, words.length - 1);
    const decl = 1 - 0.28 * prog; // phrase declination
    for (let i = 0; i < n; i++) {
      const dur = rand(0.15, 0.23); // ~4.3-6.7 syllables/s
      const stress = i === 0 ? rand(0.7, 1.0) : rand(0.42, 0.78);
      const g = groups[Math.min(i, groups.length - 1)] ?? '';
      const v = VOWELS[g[0] ?? '@'] ?? VOWELS['@']!;
      const F = (i === 0 ? v : mix3(v, VOWELS['@']!, 0.4)).map(
        (f) => f * rand(0.94, 1.06),
      ) as unknown as Triple; // unstressed drift toward schwa
      const F0 = pitch0 * (1 - 0.3 * prog) * (i === 0 ? rand(1.02, 1.12) : rand(0.92, 1.0));
      const onset = classify(segs[i] ?? '', g);
      const coda = i === n - 1 ? classify(segs[groups.length] ?? '', '') : null;
      syl.push({ t, dur, amp: stress * decl, F, F0, onset, coda });
      t += dur * rand(0.9, 1.05);
    }
    if (n === 0 || /[,:;]$/.test(w)) t += rand(0.26, 0.44); // clause pause
    else if (/[.?!…]$/.test(w)) t += rand(0.32, 0.5); // sentence pause mid-line
    else t += rand(0.03, 0.1); // word gap
  });
  return { syl, end: t + 0.9 };
}

function sylShape(x: number) {
  const a = 0.14;
  if (x < a) {
    const u = x / a;
    return u * u * (3 - 2 * u);
  }
  return (1 - (x - a) / (1 - a)) ** 1.6;
}

function envelope(syl: readonly Syllable[], t: number) {
  let v = 0;
  for (const s of syl) {
    const x = (t - s.t) / (s.dur * 1.2);
    if (x <= 0 || x >= 1) continue;
    v = Math.max(v, sylShape(x) * s.amp);
  }
  const flutter = 0.9 + 0.1 * Math.sin(t * 41.3 + 2.1 * Math.sin(t * 11.7));
  return Math.min(1, v * flutter);
}

function spectrumInto(out: Float32Array, syl: readonly Syllable[], t: number) {
  out.fill(0);
  for (let i = 0; i < syl.length; i++) {
    const s = syl[i]!;
    if (t < s.t - 0.12 || t > s.t + s.dur * 1.3 + 0.16) continue;
    const x = (t - s.t) / (s.dur * 1.2);
    if (x > 0 && x < 1) {
      const nx = syl[i + 1];
      const glide = nx && nx.t - s.t < 0.4 ? 0.45 * smoothstep(0.5, 1, x) : 0;
      const F = glide > 0 && nx ? mix3(s.F, nx.F, glide) : s.F;
      voicedInto(out, F, s.F0 * (1 - 0.06 * x), sylShape(x) * s.amp);
    }
    if (s.onset === 'p') {
      const u = (t - (s.t - 0.012)) / 0.045;
      if (u > 0 && u < 1) burstInto(out, BURST.p, (1 - u) * (1 - u) * s.amp * 0.95);
    } else if (s.onset) {
      const u = (t - (s.t - 0.085)) / 0.11;
      if (u > 0 && u < 1)
        burstInto(out, BURST[s.onset], Math.sin(Math.PI * u) ** 1.5 * s.amp * 0.9);
    }
    if (s.coda === 'p') {
      const u = (t - (s.t + s.dur * 1.05)) / 0.04;
      if (u > 0 && u < 1) burstInto(out, BURST.p, (1 - u) * (1 - u) * s.amp * 0.6);
    } else if (s.coda) {
      const u = (t - (s.t + s.dur * 1.0)) / 0.13;
      if (u > 0 && u < 1) burstInto(out, BURST[s.coda], Math.sin(Math.PI * u) ** 1.5 * s.amp * 0.8);
    }
  }
  for (let k = 0; k < BIN_COUNT; k++) {
    const x = out[k]!;
    out[k] = Math.min(1, (x * 1.45) / (1 + 0.45 * x)); // soft knee: lifts quieter detail, never clips
  }
}

export interface SyntheticVoice {
  readonly source: AnalysisSource;
  /** Starts "saying" a line now and returns how long it lasts, in milliseconds. */
  speak(text: string): number;
  stop(): void;
}

export function createSyntheticVoice(): SyntheticVoice {
  let line: { syl: Syllable[]; end: number; start: number } | null = null;
  return {
    source: {
      sample(now, out) {
        if (!line) {
          out.fill(0);
          return 0;
        }
        const t = (now - line.start) / 1000;
        if (t < 0 || t > line.end) {
          out.fill(0);
          return 0;
        }
        spectrumInto(out, line.syl, t);
        return envelope(line.syl, t);
      },
    },
    speak(text) {
      const tl = buildTimeline(text);
      line = { ...tl, start: performance.now() };
      return tl.end * 1000;
    },
    stop() {
      line = null;
    },
  };
}
