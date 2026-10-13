// Ported from scratch/plans/voice-mvp/artifacts/visuals/electric-spectrum.html, then retuned so the band follows the voice directly.

export const vertexShader = `attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const fragmentShader = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

#define TAU 6.28318531
#define NBINS 48.0
#define FIELD_W 64.0
#define FIELD_H 16.0

// Coordinates: one unit (U) = half of --orb. y is up. The x axis is FREQUENCY, not time: nothing here scrolls or travels.
uniform vec2  uRes;
uniform float uTime;
uniform float uUnit;       // device px per U
uniform float uDpr;        // device px per CSS px
uniform float uHalfLen;    // half-length of the band, in U

uniform sampler2D uSpec;   // NBINS x 1: current smoothed spectrum, log-spaced 80 Hz .. 8 kHz
uniform sampler2D uField;  // FIELD_W x FIELD_H, sampled along x: rows 1-6 per-strand in-place undulation amplitude, rows 7-12 per-strand phase jitter
uniform float uMirror;     // 1: lows at the centre, highs toward both ends. 0: linear low -> high, left to right
uniform float uGain;       // how much of the spectrum is displayed (state-dependent)
uniform vec3  uCol[6];     // per-strand colour

uniform float uCount;      // number of visible strands (fractional while transitioning)
uniform float uSpread;     // vertical spacing between resting strands, in U
uniform float uBright;
uniform float uCrackle;    // strength of the fine jitter
uniform float uCrackT;     // crackle clock: each integer step is a new jitter pattern, blended smoothly
uniform float uSpark;      // probability of forks at high-energy crests
uniform float uUnd;        // in-place noise undulation (thinking), in U
uniform float uKScale;     // carrier density
uniform float uRipple;     // standing breathing ripple (idle)
uniform float uBreath;     // -1..1
uniform float uFlicker;    // irregular brightness dropouts (error)
uniform float uBaseAmp;    // resting carrier amplitude, in U
uniform float uSigma;      // width of the Gaussian window, as a fraction of the band half-length
uniform float uPhase;      // shared carrier phase, wobbling slowly in place
uniform float uCrkFreq;    // spatial frequency multiplier for the crackle
uniform vec3  uMode[6];    // per strand: cos of mode-1 and mode-2 time phases (wandering speeds), and a slowly breathing amplitude scale
uniform float uEnergy;     // eased voice level: swells and settles with each syllable (0 when not speaking)

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 1D value noise, -1..1
float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), u) * 2.0 - 1.0;
}

// Symmetric lens envelope: soft, slow taper toward both ends
float lens(float xn) {
  float b = max(1.0 - xn * xn, 0.0);
  return b * sqrt(sqrt(b));
}

// Spectrum under band position xn.
// Linear: 80 Hz at the left end, 8 kHz at the right.
// Mirrored: the most energetic voice region (~450 Hz, between F0 and F2) sits at the centre. Moving outward, each position blends the bin that far
// toward the lows (down to 80 Hz at the ends) with the bin that far toward the highs (up to 8 kHz), so very low bins are pushed outward and the centre has no dip.
#define F_CENTRE 0.38
float specF(float f) {
  return texture2D(uSpec, vec2((clamp(f, 0.0, 1.0) * (NBINS - 1.0) + 0.5) / NBINS, 0.5)).r;
}
float specAt(float xn) {
  float lin = specF(0.5 * xn + 0.5);
  float r = (sqrt(xn * xn + 0.02) - 0.1414) / 0.8686;      // |xn|, rounded over the middle ~15% so the peak is a dome, not a point
  float lo = specF(F_CENTRE - F_CENTRE * r);
  float hi = specF(F_CENTRE + (1.0 - F_CENTRE) * r);
  float mir = 0.6 * max(lo, hi) + 0.4 * 0.5 * (lo + hi);
  return mix(lin, mir, uMirror);
}

// Gaussian window over display position. Every active state is shaped by it: amplitude, strand bunching and brightness.
float gauss(float xn) {
  return exp(-(xn * xn) / (2.0 * uSigma * uSigma));
}
float bell(float xn) {
  return 0.06 + 0.94 * gauss(xn); // a small floor keeps the ends alive
}

// x: undulation amplitude (0..1.5), y: phase jitter in radians (-1.5..1.5). Both evolve in place over time.
vec2 fieldAt(float xn, float fi) {
  float u = (clamp(0.5 * xn + 0.5, 0.0, 1.0) * (FIELD_W - 1.0) + 0.5) / FIELD_W;
  float a = texture2D(uField, vec2(u, (fi + 1.5) / FIELD_H)).r;
  float j = texture2D(uField, vec2(u, (fi + 7.5) / FIELD_H)).r;
  return vec2(a * 1.5, (j - 0.5) * 3.0);
}

// Fine electric jitter: two octaves of value noise; the pattern re-rolls on each crackle step and cross-fades between steps (in place).
float crackle(float x, float seed) {
  float tA = floor(uCrackT);
  float fr = fract(uCrackT);
  fr = fr * fr * (3.0 - 2.0 * fr);
  float o = seed * 37.7;
  float a = 0.65 * vnoise(x * 11.0 + o + tA * 19.31) + 0.35 * vnoise(x * 29.0 - o + tA * 7.77);
  float b = 0.65 * vnoise(x * 11.0 + o + (tA + 1.0) * 19.31) + 0.35 * vnoise(x * 29.0 - o + (tA + 1.0) * 7.77);
  return mix(a, b, fr);
}

// Bell envelope: a true Gaussian peak in the middle, falling smoothly into the soft lens ends (small floor keeps the ends alive).
float bellEnv(float xn) {
  return (0.04 + 0.96 * gauss(xn)) * lens(xn);
}

// Vertical position of strand fi at x (in U). Each strand is a vibrating string: two standing modes with their own shapes, whose time phases
// (uMode.xy) advance at noise-wandering speeds. Nothing travels sideways and nothing is pinned to a shared crest, so the middle stays alive.
// While speaking, the overall loudness sets the modes' height under a Gaussian bell, so the peaks and valleys are tallest in the centre and
// die away quickly toward the ends. The spectrum only colours the glow; it no longer shapes the waves. The modes pass through zero on their own clock, so a small lean (upper strands
// up, lower down, under the same bell) keeps every syllable visible whatever phase they are in.
float strandY(float x, float fi, vec2 fld, vec3 md, float crk) {
  float xn = x / uHalfLen;
  float env = bellEnv(xn);
  float bellX = gauss(xn);
  float k1 = (3.2 + 0.7 * fi) * 3.14159265 * uKScale;
  float k2 = (6.5 + 1.1 * fi) * 3.14159265 * uKScale;
  float s1 = fi * 2.39 + 0.6 * fld.y;                               // spatial phases morph in place with the jitter field
  float s2 = fi * 4.11 - 0.9 * fld.y;
  float w = 0.65 * sin(k1 * xn + s1) * md.x + 0.35 * sin(k2 * xn + s2) * md.y;
  float strand = md.z * (1.0 - 0.08 * fi);
  float amp = (uBaseAmp + uUnd * fld.x) * env + 1.45 * uEnergy * bellX;
  amp *= strand;
  amp = amp / (1.0 + 0.35 * amp);                                   // soft limiter: loud peaks round off instead of leaving the canvas
  float c0 = 0.5 * (uCount - 1.0);
  float lane = (fi - c0) / max(c0, 1.0);                            // -1 (bottom strand) .. 1 (top strand)
  float lean = 0.25 * uEnergy * lane * bellX;
  float y = (fi - c0) * uSpread * (0.35 + 0.65 * env);              // the bundle is widest in the middle and never collapses to one line
  y += amp * w + lean;
  y += crk * (0.35 + 0.65 * env) * crackle(x * uCrkFreq, fi);
  return y;
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 p = (fc - 0.5 * uRes) / uUnit;
  float xn = p.x / uHalfLen;
  float axn = abs(xn);

  vec3 acc = vec3(0.0);

  if (axn < 1.0 && abs(p.y) < 1.4) {
    float h = 1.5 / uUnit;                                  // finite-difference step (1.5 device px)
    float xA = p.x - 0.5 * h;
    float xB = p.x + 0.5 * h;
    float xnA = xA / uHalfLen;
    float xnB = xB / uHalfLen;
    float eA = specAt(xnA) * uGain;
    float eB = specAt(xnB) * uGain;
    float e = 0.5 * (eA + eB) * (0.5 + 0.5 * bell(xn));     // brightness follows the bell too, more gently than amplitude
    float env = lens(xn);
    float lineEnv = (1.0 - smoothstep(0.8, 1.0, axn)) * (0.45 + 0.55 * env);
    float soft = smoothstep(0.62, 1.0, axn);                // toward the ends, cores widen and blur as they fade
    float c0 = 0.5 * (uCount - 1.0);
    float crT = floor(uTime * 11.0);

    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float vis = clamp(uCount - fi, 0.0, 1.0);
      if (vis <= 0.001) continue;

      vec3 md = uMode[i];
      vec2 fA = fieldAt(xnA, fi);
      vec2 fB = fieldAt(xnB, fi);
      float crk = uCrackle * (0.010 + 0.035 * e);

      float yA = strandY(xA, fi, fA, md, crk);
      float yB = strandY(xB, fi, fB, md, crk);
      float y = 0.5 * (yA + yB);
      float s = (yB - yA) / h;
      float d = abs(p.y - y) * inversesqrt(1.0 + s * s) * uUnit; // perpendicular distance, device px

      float wc = uDpr * (0.5 + 0.5 * e);
      float gw = uDpr * (2.8 + 5.0 * e);
      float edge = 1.0 + 4.0 * soft * uDpr;
      float core = clamp((wc + 0.5 * edge - d) / edge, 0.0, 1.0);
      float g = gw / (d + gw);
      float glow = g * g;
      float haze = exp(-d / (0.3 * uUnit));

      float fl = hash11(fi * 13.7 + crT);
      float flick = 1.0 - uFlicker * (0.55 * step(0.72, fl) + 0.25 * (0.5 + 0.5 * sin(uTime * (5.3 + fi * 2.1) + fi * 2.0) * sin(uTime * 1.7 + fi)));
      float inten = uBright * vis * flick * lineEnv * (0.5 + 0.45 * e) * (0.6 + 0.55 * gauss(xn)); // brightness concentrates in the centre

      vec3 c = uCol[i];
      vec3 hotC = mix(c, vec3(1.0), 0.15 + 0.5 * smoothstep(0.55, 0.95, e)); // only near-peak cores approach white
      acc += hotC * core * inten * (0.92 - 0.35 * soft);
      acc += c * glow * inten * 0.36;
      acc += c * haze * inten * 0.018 * (0.4 + e);
    }
    acc *= 1.0 - smoothstep(1.05, 1.38, abs(p.y));
  }

  vec3 rgb = 1.0 - exp(-acc * 1.15);

  // Triangular dither to kill banding in the soft gradients
  float dn = (hash12(fc + fract(uTime * 7.13) * 113.0) + hash12(fc.yx + fract(uTime * 3.71) * 71.0) - 1.0) / 255.0;
  rgb = clamp(rgb + dn, 0.0, 1.0);
  float a = max(max(rgb.r, rgb.g), rgb.b); // premultiplied: alpha tracks the brightest channel
  gl_FragColor = vec4(rgb, a);
}`;
