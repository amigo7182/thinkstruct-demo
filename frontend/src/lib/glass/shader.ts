// The whole toggle is one fragment shader: the track, a pixel-matrix icon beneath a glass
// knob that refracts (with a little chromatic aberration) and frosts it, and a light strip
// that hugs the glass and orbits it as the knob travels. GLSL ES 1.00, so it runs on both
// WebGL 1 and WebGL 2. Coordinates are CSS pixels, y down, origin at the canvas's top left.

export const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_res;        // canvas size, device pixels
uniform float u_dpr;
uniform vec2 u_trackC;
uniform vec2 u_trackHalf;
uniform float u_trackR;
uniform vec2 u_knobC;
uniform float u_knobHalf;
uniform float u_knobR;
uniform float u_pos;       // knob position: 0 = night (left) .. 1 = day (right)
uniform float u_light;     // 1 when the page around the toggle is light
uniform float u_cell;      // pitch of the pixel matrix
uniform vec4 u_pix[32];    // lit pixels: xy from the knob centre, z size (0 = unused), w 0 moon .. 1 sun colour

const float PI = 3.14159265;
const vec3 NIGHT = vec3(0.55, 0.64, 1.0);   // the strip at night: cool, from below
const vec3 DAY = vec3(1.0, 0.66, 0.24);     // by day: warm, from above
const vec3 MOON_PX = vec3(1.0, 0.95, 0.86);
const vec3 SUN_PX = vec3(0.92, 0.45, 0.04);

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float knobSd(vec2 p) { return sdBox(p - u_knobC, vec2(u_knobHalf), u_knobR); }
float trackSd(vec2 p) { return sdBox(p - u_trackC, u_trackHalf, u_trackR); }

vec3 strip() { return mix(NIGHT, DAY, u_pos); }

// The strip sits at the bottom at night, at the top by day, and orbits round the leading
// side in between.
float stripAngle() { return PI * 0.5 - PI * u_pos; }

// 1 where p lies in the strip's direction as seen from the knob centre. Only meaningful
// away from the centre (on the rim and outside it), where the angle is stable.
float lobe(vec2 p, float width) {
  vec2 q = p - u_knobC;
  float d = abs(mod(atan(q.y, q.x) - stripAngle() + PI, 2.0 * PI) - PI);
  return exp(-(d * d) / (width * width));
}

// The one glow model: coloured light laid over whatever is beneath it (track, glass or page)
// with alpha 1 - e^-intensity, so it reads the same on dark and light.
vec3 over(vec3 base, vec3 light, float intensity) { return mix(base, light, 1.0 - exp(-intensity)); }

// The pixel matrix: faint unlit cells, and the lit pixels wherever the morph has put them.
vec3 icon(vec2 q, vec3 col) {
  float h = u_cell * 5.5;
  if (abs(q.x) > h || abs(q.y) > h) return col;
  vec2 g = q / u_cell;
  vec2 cell = floor(g + 0.5);
  if (abs(cell.x) <= 4.0 && abs(cell.y) <= 4.0) {
    vec2 d = abs(g - cell) - 0.36;
    float m = 1.0 - smoothstep(-0.06, 0.06, max(d.x, d.y));
    col = mix(col, mix(vec3(1.0), vec3(0.0), u_pos), m * 0.08);
  }
  for (int i = 0; i < 32; i++) {
    vec4 px = u_pix[i];
    if (px.z <= 0.0) continue;
    vec2 d = abs(q - px.xy) - 0.5 * px.z;
    float m = 1.0 - smoothstep(-0.3, 0.3, max(d.x, d.y));
    col = mix(col, mix(MOON_PX, SUN_PX, px.w), m);
  }
  return col;
}

// Everything that sits beneath the glass: the track, the knob's shadow, the strip's wash, the icon.
vec3 scene(vec2 p) {
  float sdT = trackSd(p);
  vec3 col = mix(vec3(0.035, 0.038, 0.046), vec3(0.85, 0.865, 0.85), u_pos);
  col *= 1.0 - mix(0.5, 0.12, u_pos) * exp(sdT / 3.0);                 // inner shadow at the rim
  float sh = sdBox(p - u_knobC - vec2(0.0, 2.5), vec2(u_knobHalf - 0.5), u_knobR);
  col *= 1.0 - mix(0.55, 0.22, u_pos) * exp(-max(sh, 0.0) / 3.0);      // the knob's shadow
  float sdK = knobSd(p);
  float wash = lobe(p, 1.0) * exp(-max(sdK, 0.0) / 6.0) * smoothstep(-3.0, 0.5, sdK); // the track around the knob
  col = over(col, strip(), wash * 0.75);
  return icon(p - u_knobC, col);
}

vec3 glass(vec2 p, float sdK) {
  float depth = -sdK;                                    // px inside the edge
  float rim = 1.0 - smoothstep(0.0, 8.0, depth);         // 1 on the bevel, 0 in the flat middle
  vec2 e = vec2(0.35, 0.0);
  vec2 n = vec2(knobSd(p + e.xy) - knobSd(p - e.xy), knobSd(p + e.yx) - knobSd(p - e.yx));
  n /= max(length(n), 1e-4);                             // outward surface normal
  vec2 bend = -n * rim * rim * 3.8;                      // the bevel refracts what's beneath inwards
  float frost = mix(0.45, 1.8, rim);
  vec3 c = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float a = float(k) * 1.5708 + 0.7854;
    vec2 j = vec2(cos(a), sin(a)) * frost;
    c.r += scene(p + bend * 0.88 + j).r;                 // each channel bends a little differently
    c.g += scene(p + bend * 1.00 + j).g;
    c.b += scene(p + bend * 1.14 + j).b;
  }
  c *= 0.25;
  float top = clamp((p.y - (u_knobC.y - u_knobHalf)) / (2.0 * u_knobHalf), 0.0, 1.0);
  vec3 body = mix(vec3(0.6, 0.63, 0.7), vec3(1.0), u_pos) * (1.08 - 0.16 * top);
  c = mix(c, body, mix(0.28, 0.3, u_pos) * (0.75 + 0.25 * rim));
  vec2 L = normalize(vec2(-0.35, -1.0));
  c += pow(max(dot(n, L), 0.0), 3.0) * rim * 0.45;     // the bevel catching the light
  c += exp(-depth / 0.6) * 0.22;                         // bright inner rim
  // The strip scattering into the glass: strong along the rim beside it, and a soft spot
  // spreading from where it touches the glass (smooth all the way to the centre).
  vec2 q = p - u_knobC;
  vec2 toward = vec2(cos(stripAngle()), sin(stripAngle()));
  float alongRim = lobe(p, 0.85) * exp(-depth / 4.5) * smoothstep(0.45, 0.85, length(q) / u_knobHalf);
  float spot = exp(-length(q - toward * u_knobHalf) / 9.0) * 0.7;
  return over(c, strip(), alongRim * 1.3 + spot);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_dpr;
  float aa = 0.75 / u_dpr;
  float sdT = trackSd(p);
  float sdK = knobSd(p);
  float inTrack = 1.0 - smoothstep(-aa, aa, sdT);
  float inKnob = 1.0 - smoothstep(-aa, aa, sdK);

  // The strip itself: a bright band just outside the glass.
  float band = lobe(p, 0.62) * exp(-((sdK - 1.4) * (sdK - 1.4)) / 0.9) * 3.0;
  vec3 hot = mix(strip(), vec3(1.0), 0.4);

  vec3 col = vec3(0.0);
  if (inTrack > 0.0) {
    col = scene(p);
    if (inKnob > 0.0) col = mix(col, glass(p, sdK), inKnob);
    float hair = 1.0 - smoothstep(0.0, 0.5 + 1.2 / u_dpr, abs(sdT + 0.5));
    col = mix(col, mix(vec3(1.0), vec3(0.0), u_pos), hair * 0.14);       // the track's outline
    float knobLine = 1.0 - smoothstep(0.0, 1.0, abs(sdK - 0.3));
    col = mix(col, vec3(0.0), knobLine * 0.16 * u_pos);                    // define the glass by day
    col = over(col, hot, band);
  }

  // Outside the track the same light spills onto the page, fading out before the canvas ends.
  vec2 size = u_res / u_dpr;
  float margin = min(min(p.x, size.x - p.x), min(p.y, size.y - p.y));
  float spill = lobe(p, 1.05) * exp(-max(sdK, 0.0) / 11.0) * 0.9 * smoothstep(0.0, 16.0, margin);
  float glowA = 1.0 - exp(-(spill + band) * mix(1.0, 1.45, u_light));
  vec3 glow = mix(strip(), strip() * 0.86, u_light) * glowA;              // premultiplied

  gl_FragColor = vec4(col * inTrack + glow * (1.0 - inTrack), inTrack + glowA * (1.0 - inTrack));
}
`;
