/** GLSL ES 3.00 sources. All passes share the fullscreen vertex shader. */

export const VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const COLOR_SPACE = /* glsl */ `
// NTSC YIQ, as used in the original paper. Y is luma, I/Q are chroma.
vec3 rgb2yiq(vec3 c) {
  return vec3(
    dot(c, vec3(0.299, 0.587, 0.114)),
    dot(c, vec3(0.596, -0.274, -0.322)),
    dot(c, vec3(0.211, -0.523, 0.312)));
}
vec3 yiq2rgb(vec3 c) {
  return vec3(
    dot(c, vec3(1.0, 0.956, 0.621)),
    dot(c, vec3(1.0, -0.272, -0.647)),
    dot(c, vec3(1.0, -1.106, 1.703)));
}
`

/** Camera frame → YIQ at processing resolution, with optional box pre-blur. */
export const FS_YIQ = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_video;
uniform vec2 u_texel;     // 1 / processing size
uniform int u_radius;     // 0..3
out vec4 o_color;
${COLOR_SPACE}
void main() {
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for (int y = -3; y <= 3; y++) {
    for (int x = -3; x <= 3; x++) {
      if (abs(x) > u_radius || abs(y) > u_radius) continue;
      sum += texture(u_video, v_uv + vec2(x, y) * u_texel).rgb;
      n += 1.0;
    }
  }
  o_color = vec4(rgb2yiq(sum / n), 1.0);
}
`

/** Gaussian downsample by 2 with a separable-equivalent 3x3 kernel [1 2 1]/16 (input sampled bilinearly). */
export const FS_DOWNSAMPLE = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_srcTexel;
out vec4 o_color;
void main() {
  // 4 bilinear taps at half-texel offsets approximate a 4x4 Gaussian footprint.
  vec2 o = u_srcTexel * 0.75;
  vec3 c = texture(u_src, v_uv + vec2(-o.x, -o.y)).rgb
         + texture(u_src, v_uv + vec2( o.x, -o.y)).rgb
         + texture(u_src, v_uv + vec2(-o.x,  o.y)).rgb
         + texture(u_src, v_uv + vec2( o.x,  o.y)).rgb;
  o_color = vec4(c * 0.25, 1.0);
}
`

/** Laplacian level: fine − upsample(coarse). Bilinear upsampling via the sampler. */
export const FS_LAPLACIAN = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_fine;
uniform sampler2D u_coarse;
out vec4 o_color;
void main() {
  o_color = vec4(texture(u_fine, v_uv).rgb - texture(u_coarse, v_uv).rgb, 1.0);
}
`

/**
 * Temporal IIR update. Two first-order low-passes with different cutoffs;
 * their difference (computed in the accumulate pass) is the band-pass signal.
 */
export const FS_TEMPORAL = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_input;
uniform sampler2D u_lo;
uniform sampler2D u_hi;
uniform float u_rLo;   // exp(-2π fLow dt)
uniform float u_rHi;   // exp(-2π fHigh dt)
uniform bool u_reset;
layout(location = 0) out vec4 o_lo;
layout(location = 1) out vec4 o_hi;
void main() {
  vec3 x = texture(u_input, v_uv).rgb;
  if (u_reset) {
    o_lo = vec4(x, 1.0);
    o_hi = vec4(x, 1.0);
    return;
  }
  vec3 lo = texture(u_lo, v_uv).rgb;
  vec3 hi = texture(u_hi, v_uv).rgb;
  o_lo = vec4(mix(x, lo, u_rLo), 1.0);
  o_hi = vec4(mix(x, hi, u_rHi), 1.0);
}
`

/**
 * Accumulate amplified band signal from coarse to fine:
 *   acc_i = α_i · atten · (hi_i − lo_i) + upsample(acc_{i+1})
 */
export const FS_ACCUMULATE = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_lo;
uniform sampler2D u_hi;
uniform sampler2D u_prev;
uniform bool u_hasBand;
uniform bool u_hasPrev;
uniform float u_alpha;
uniform float u_chroma;
out vec4 o_color;
void main() {
  vec3 acc = vec3(0.0);
  if (u_hasBand) {
    vec3 band = texture(u_hi, v_uv).rgb - texture(u_lo, v_uv).rgb;
    acc += band * u_alpha * vec3(1.0, u_chroma, u_chroma);
  }
  if (u_hasPrev) acc += texture(u_prev, v_uv).rgb;
  o_color = vec4(acc, 1.0);
}
`

/** Final composite to the canvas at display resolution. */
export const FS_COMPOSITE = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_video;
uniform sampler2D u_acc;
uniform float u_blend;
uniform bool u_isolate;
uniform bool u_mirror;
uniform bool u_bypass;
out vec4 o_color;
${COLOR_SPACE}
void main() {
  vec2 uv = u_mirror ? vec2(1.0 - v_uv.x, v_uv.y) : v_uv;
  vec3 rgb = texture(u_video, uv).rgb;
  if (u_bypass) { o_color = vec4(rgb, 1.0); return; }
  vec3 acc = texture(u_acc, uv).rgb * u_blend;
  vec3 yiq = u_isolate ? vec3(0.5, 0.0, 0.0) + acc : rgb2yiq(rgb) + acc;
  o_color = vec4(clamp(yiq2rgb(yiq), 0.0, 1.0), 1.0);
}
`
