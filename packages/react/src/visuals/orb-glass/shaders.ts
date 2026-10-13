// Ported verbatim from scratch/plans/voice-mvp/artifacts/visuals/orb-glass.html. Keep in sync by copy, not by edit.

export const vertexShader = `attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const fragmentShader = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  uRes;
uniform float uTime;
uniform float uFlowT;    // integrated internal flow time
uniform float uSpin;     // integrated slow rotation of the inner currents
uniform float uTwist;    // radial swirl amount (energy + thinking churn)
uniform float uEnergy;   // smoothed audio energy 0..1
uniform float uBright;   // overall luminance
uniform float uCurrent;  // intensity of the inner currents
uniform float uWarp;     // domain-warp strength (churn)
uniform float uHalo;     // outer halo strength
uniform float uBreath;   // -1..1 breathing phase (already scaled by amplitude)
uniform float uRadius;   // orb radius in normalized units (canvas half-size = 1)
uniform vec3  uColA;     // dominant tone
uniform vec3  uColB;     // secondary tone
uniform vec3  uColC;     // accent
uniform vec3  uBase;     // dark glass body tint

const mat2 OCT = mat2(0.80, 0.60, -0.60, 0.80);

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Gradient noise with quintic interpolation, roughly -0.7..0.7
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(i), f);
  float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * gnoise(p);
    p = OCT * p * 2.03 + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return s;
}

float fbm4(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * gnoise(p);
    p = OCT * p * 2.03 + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return s;
}

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

// One sheet of luminous current at a given depth (0 = front, 1 = back).
// Domain-warped fbm gives a soft cloud; iso-contours of the same field become thin aurora ribbons.
vec3 currentLayer(vec2 uv, float depth, float seed, float t) {
  vec2 p = uv * mix(1.25, 2.1, depth);
  float wt = t * mix(1.0, 0.6, depth);
  vec2 w = vec2(fbm3(p + vec2(seed, wt * 0.55)),
                fbm3(p + vec2(5.2 - wt * 0.45, seed * 1.31 + 1.7)));
  vec2 p2 = p + uWarp * 1.35 * w + vec2(wt * 0.16, -wt * 0.30);
  float f = fbm4(p2 + vec2(seed * 0.37, -seed * 0.21));

  float cloud = smoothstep(-0.05, 0.6, f);
  float wd = mix(0.03, 0.065, depth) * (1.0 + 0.7 * uEnergy);
  float r1 = 1.0 - smoothstep(0.0, wd, abs(f - 0.10));
  float r2 = 1.0 - smoothstep(0.0, wd * 0.75, abs(f + 0.20));
  float rib = r1 * r1 + 0.5 * r2 * r2;
  rib *= 0.8 + 0.4 * gnoise(p2 * 2.6 - vec2(0.0, t * 0.8));

  float h = smoothstep(-0.3, 0.3, w.x - 0.6 * w.y + 0.2 * sin(t * 0.35 + seed));
  vec3 c = mix(uColA, uColB, h);
  c = mix(c, uColC, 0.4 * smoothstep(0.2, 0.55, f));
  return c * (cloud * cloud * 0.34 + rib * 0.95);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  float minRes = min(uRes.x, uRes.y);
  vec2 p = (fc - 0.5 * uRes) / (0.5 * minRes);
  float px = 2.0 / minRes;
  float R = uRadius * (1.0 + 0.011 * uBreath);
  float rr = length(p);
  float mask = 1.0 - smoothstep(R - px, R + 0.5 * px, rr);

  // ---- Outer pastel halo (in-shader bloom) ----
  float e = max(rr - R, 0.0);
  vec2 dir = p / max(rr, 1e-4);
  float hn = 0.5 + 0.9 * gnoise(dir * 1.7 + vec2(uFlowT * 0.12, uSpin * 0.6));
  float hs = clamp(0.65 * hn + 0.35 * (0.5 + 0.5 * dot(dir, vec2(0.6, -0.8))), 0.0, 1.0);
  vec3 hc = mix(uColA, uColB, hs);
  hc = mix(hc, vec3(1.0), 0.16);
  float hk = uHalo * (1.0 + uEnergy) * (1.0 + 0.08 * uBreath);
  float halo = exp(-e * 24.0) * 0.32 + exp(-e * 8.0) * 0.20 + exp(-e * 3.2) * 0.08;
  halo *= hk * (1.0 - smoothstep(0.7, 1.0, rr));
  vec3 haloRGB = 1.0 - exp(-hc * halo * 1.3);

  vec3 sphere = vec3(0.0);
  if (mask > 0.0) {
    // Fake 3D: lift the disc into a hemisphere
    vec2 q = p / R;
    float r2 = dot(q, q);
    if (r2 > 1.0) {
      q *= inversesqrt(r2);
      r2 = 1.0;
    }
    float z = sqrt(max(1.0 - r2, 0.0));
    vec3 n = vec3(q, z);
    float rq = sqrt(r2);
    float tw = uTwist * (1.0 - r2);

    // Three refracted sheets at different depths; stronger lensing toward the back
    vec3 inner = vec3(0.0);
    vec2 lb = q / mix(0.34, 1.0, z);
    inner += currentLayer(rot(uSpin * 0.55 + tw * 0.55) * lb, 1.0, 11.0, uFlowT) * 0.45;
    vec2 lm = q / mix(0.42, 1.0, z);
    inner += currentLayer(rot(-uSpin * 0.35 + tw * 0.85 + 1.3) * lm, 0.5, 23.0, uFlowT * 1.1) * 0.60;
    vec2 lf = q / mix(0.5, 1.0, z);
    inner += currentLayer(rot(uSpin * 0.8 + tw * 1.25 + 2.4) * lf, 0.0, 37.0, uFlowT * 1.2) * 0.75;

    // Volume thickness: more glow through the thick centre, fading toward the rim
    inner *= (0.3 + 0.8 * z) * (1.0 - 0.55 * smoothstep(0.78, 1.0, rq));
    inner += mix(uColA, uColC, 0.3) * exp(-r2 * 3.2) * (0.10 + 0.40 * uEnergy);
    inner *= uCurrent * (0.72 + 0.95 * uEnergy) * uBright;

    vec3 body = uBase * (0.55 + 0.45 * z) + uColA * 0.03;
    vec3 c = body + inner;

    // Dark band just inside the rim (thick glass bending light away)
    c *= 1.0 - 0.32 * smoothstep(0.70, 0.93, rq) * (1.0 - smoothstep(0.93, 1.0, rq));

    // Fresnel rim
    float fz = max(1.0 - z, 1e-4);
    float fres = pow(fz, 2.4);
    float edge = pow(fz, 5.0);
    float g = smoothstep(-0.9, 0.9, 0.6 * q.x - 0.8 * q.y);
    vec3 rimCol = mix(uColA, uColB, g);
    rimCol = mix(rimCol, uColC, 0.3 * smoothstep(0.2, 1.0, 0.8 * q.x + 0.6 * q.y));
    rimCol = mix(rimCol, vec3(1.0), 0.3);
    c += rimCol * (fres * (0.42 + 0.40 * uEnergy) + edge * 0.5) * uBright;

    // Caustic: light focused on the far (lower-right) inner wall
    float cau = smoothstep(0.15, 0.95, dot(q, vec2(0.6, -0.8))) * smoothstep(0.5, 0.97, rq);
    c += mix(uColB, vec3(1.0), 0.35) * cau * cau * (0.30 + 0.35 * uEnergy) * uBright;

    c = 1.0 - exp(-c * 1.3);

    // Specular: a crisp point light plus a soft window reflection hugging the upper-left curve
    vec3 L = normalize(vec3(-0.48, 0.62, 0.62));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float nh = max(dot(n, H), 0.0);
    float spec = pow(nh, 150.0) * 0.95 + pow(nh, 24.0) * 0.08;
    vec2 sp = q - vec2(-0.42, 0.58);
    float al = dot(sp, vec2(0.8, 0.6));
    float ac = dot(sp, vec2(-0.6, 0.8));
    float sb = exp(-(al * al) / 0.05 - (ac * ac) / 0.006);
    c += vec3(1.0, 0.985, 1.0) * (spec + sb * 0.38) * mix(0.4, 1.0, uBright);

    sphere = c;
  }

  vec3 rgb = mix(haloRGB, sphere, mask);
  float a = mix(max(max(haloRGB.r, haloRGB.g), haloRGB.b), 0.95, mask);

  // Triangular dither to kill banding in the soft gradients
  float dn = (hash12(fc + fract(uTime * 7.13) * 113.0) + hash12(fc.yx + fract(uTime * 3.71) * 71.0) - 1.0) / 255.0;
  rgb = clamp(rgb + dn, 0.0, 1.0);
  a = clamp(a + dn, 0.0, 1.0);
  a = max(a, max(max(rgb.r, rgb.g), rgb.b)); // keep premultiplied-valid
  gl_FragColor = vec4(rgb, a);
}`;
