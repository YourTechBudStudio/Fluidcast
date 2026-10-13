// Ported verbatim from scratch/plans/voice-mvp/artifacts/visuals/orb-mixing.html. Keep in sync by copy, not by edit.

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
uniform float uFlowT;      // integrated flow time (speeds up with energy)
uniform float uSpin;       // integrated slow rotation of the whole colour field
uniform float uTwist;      // radial swirl amount (energy + thinking churn)
uniform float uEnergy;     // smoothed audio energy 0..1 (fast)
uniform float uEnergySlow; // slower follower of uEnergy: swirl, colour bloom, size pulse
uniform float uBright;     // overall luminance
uniform float uInk;        // how far the darker ink pockets sink toward uBase
uniform float uWarp;       // domain-warp strength (churn)
uniform float uSat;        // saturation (offline is nearly grey)
uniform float uAccent;     // weight of the fourth accent tone
uniform float uHalo;       // outer glow strength
uniform float uCore;       // strength of the soft inner light seen through the glass
uniform float uBreath;     // -1..1 breathing phase (already scaled by amplitude)
uniform float uRadius;     // orb radius in normalized units (canvas half-size = 1)
uniform vec3  uColA;       // dominant tone
uniform vec3  uColB;       // secondary tone
uniform vec3  uColC;       // third tone
uniform vec3  uColD;       // accent tone
uniform vec3  uBase;       // deep ink tint for the darker pockets

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

// Three soft octaves (gentle gain for broad pools), rescaled to std ~0.25, range roughly -1..1
float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * gnoise(p);
    p = OCT * p * 2.03 + vec2(3.1, 1.7);
    a *= 0.42;
  }
  return s * 2.9;
}

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

vec3 toLin(vec3 c) { return c * c; }
vec3 toGam(vec3 c) { return sqrt(max(c, vec3(0.0))); }

vec3 saturateTo(vec3 c, float s) {
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(mix(vec3(y), c, s), vec3(0.0));
}

// Liquid colour field: two levels of domain warping advect the palette like ink in water, so the tones
// genuinely fold into each other. Blending happens in (approximately) linear light so neighbouring pastels
// mix cleanly instead of going muddy. rgb = display-space colour (before the glass finish), a = ink density.
vec4 inkField(vec2 q, float t) {
  vec2 s = q * 0.8;
  vec2 w1 = vec2(fbm3(s + vec2(0.0, t * 0.21)),
                 fbm3(s + vec2(5.2, 1.3) - vec2(t * 0.17, 0.0)));
  vec2 s2 = 1.25 * (s + uWarp * 0.55 * w1);
  vec2 w2 = vec2(fbm3(s2 + vec2(1.7, 9.2) + vec2(t * 0.11, -t * 0.07)),
                 fbm3(s2 + vec2(8.3, 2.8) - vec2(t * 0.09, t * 0.13)));
  vec2 s3 = s + uWarp * 0.7 * w2;
  float f1 = fbm3(s3 * 0.85 + vec2(t * 0.05, 3.3));

  // Colour pools: A dominates, B and C diffuse through it, D surfaces as a faint accent
  float mB = smoothstep(-0.30, 0.45, f1);
  float mC = smoothstep(-0.10, 0.70, w2.x + 0.35 * w1.y);
  float mD = smoothstep(0.15, 0.85, w2.y - 0.40 * f1);
  vec3 c = mix(toLin(uColA), toLin(uColB), mB);
  c = mix(c, toLin(uColC), mC * 0.85);
  c = mix(c, toLin(uColD), mD * uAccent);

  // Ink density: soft lighter and deeper pockets
  float ink = smoothstep(-0.55, 0.55, 0.7 * w1.x - 0.5 * f1 + 0.45 * w2.y);
  c = mix(toLin(uBase), c, mix(1.0 - uInk, 1.0, ink));

  // Speech energy blooms the luminous pools most, so the liquid brightens from within
  float bloom = 0.3 * uEnergy + 0.25 * uEnergySlow;
  c *= 1.0 + bloom * (0.3 + 0.7 * ink);

  return vec4(saturateTo(toGam(c), uSat * 1.15 * (1.0 + 0.15 * uEnergySlow)), ink);
}

// Identity below the knee, smooth shoulder that tops out below white: luminous, never blown out
vec3 softClip(vec3 c) {
  vec3 x = max(c - 0.62, 0.0);
  return min(c, vec3(0.62)) + 0.3 * (1.0 - exp(-x / 0.3));
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  float minRes = min(uRes.x, uRes.y);
  vec2 p = (fc - 0.5 * uRes) / (0.5 * minRes);
  float rr = length(p);
  float px = 2.0 / minRes; // one device pixel in normalized units
  // Breathes, and swells slightly with the voice
  float R = uRadius * (1.0 + 0.012 * uBreath + 0.012 * uEnergySlow);
  // Crisp body: a hard circle with ~1.5 device px of anti-aliasing; the glow stays outside it
  float body = 1.0 - smoothstep(R - px, R + 0.5 * px, rr);

  // ---- Outer pastel glow, emanating from the edge ----
  float e = max(rr - R * 0.94, 0.0);
  vec2 dir = p / max(rr, 1e-4);
  float hs = clamp(0.5 + 1.1 * gnoise(dir * 1.3 + vec2(uFlowT * 0.07, uSpin * 0.5)), 0.0, 1.0);
  vec3 hc = mix(uColA, uColB, hs);
  vec2 sd = vec2(cos(uSpin), sin(uSpin));
  hc = saturateTo(mix(hc, uColC, 0.3 * smoothstep(0.1, 0.9, 0.5 + 0.5 * dot(dir, sd))), uSat);
  float hk = uHalo * (1.0 + 0.8 * uEnergy + 0.3 * uEnergySlow) * (1.0 + 0.08 * uBreath);
  float halo = exp(-e * 16.0) * 0.30 + exp(-e * 6.0) * 0.17 + exp(-e * 2.6) * 0.07;
  halo *= hk * (1.0 - smoothstep(0.72, 1.0, rr));
  vec3 haloRGB = 1.0 - exp(-hc * halo * 1.4);

  vec3 orb = vec3(0.0);
  if (body > 0.0) {
    vec2 q = p / R;
    float r2 = min(dot(q, q), 1.0);
    float z = sqrt(1.0 - r2);
    float rq = sqrt(r2);
    float t = uFlowT;

    // The liquid is seen through a glass dome: a gentle lens compresses it toward the rim
    vec2 ql = q / mix(0.8, 1.0, z);
    float tw = uTwist * 0.55 * (1.0 - smoothstep(0.0, 1.2, r2));
    vec4 f = inkField(rot(uSpin * 0.6 + tw) * ql, t);
    vec3 col = f.rgb;

    // Self-illumination: a thicker path through the middle glows more; edges keep saturated pastels.
    // Falloff is linear in r^2 (not z) so it has no steep slope at the rim that would read as a feathered edge.
    float thick = 0.66 + 0.3 * (1.0 - r2);
    vec3 c = col * thick * (0.86 + 0.2 * f.a);

    // Limb: a thin self-lit band just inside the edge gets a touch more saturation and light (the glassy rim, no white)
    float limb = smoothstep(0.86, 0.995, rq);
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(lum), c, 1.0 + 0.25 * smoothstep(0.5, 1.0, rq) + 0.2 * limb);
    c *= 1.0 + 0.1 * limb;

    // Soft, slowly wandering inner light, tinted by the palette rather than white; brightens and widens with energy
    vec2 cq = q - 0.1 * vec2(sin(t * 0.21 + 1.3), cos(t * 0.17));
    float core = exp(-dot(cq, cq) * mix(3.6, 2.5, uEnergy));
    vec3 coreTint = mix(vec3(1.0), mix(uColA, uColB, 0.3), 0.55);
    c += saturateTo(coreTint, uSat) * core * uCore * (0.24 + 0.42 * uEnergy);

    orb = softClip(max(c * uBright, 0.0));
  }

  vec3 rgb = mix(haloRGB, orb, body);
  float a = mix(max(max(haloRGB.r, haloRGB.g), haloRGB.b), 0.92, body);

  // Triangular dither to kill banding in the soft gradients
  float dn = (hash12(fc + fract(uTime * 7.13) * 113.0) + hash12(fc.yx + fract(uTime * 3.71) * 71.0) - 1.0) / 255.0;
  rgb = clamp(rgb + dn, 0.0, 1.0);
  a = clamp(a + dn, 0.0, 1.0);
  a = max(a, max(max(rgb.r, rgb.g), rgb.b)); // keep premultiplied-valid
  gl_FragColor = vec4(rgb, a);
}`;
