// WebGL2 image processing engine. One fragment shader applies the full
// develop pipeline: crop/rotation (UV mapping) -> sharpening -> white
// balance -> exposure -> tone -> contrast -> tone curve (LUT) -> HSL ->
// presence -> local masks -> vignette -> grain.
// Used for the live develop preview and full-resolution export rendering.

import { HSL_BANDS } from './adjustments';
import { buildCurveLUT } from './curve';
import { rasterizeMasks } from './masks';

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform sampler2D u_curve;
uniform sampler2D u_mask0;
uniform sampler2D u_mask1;
uniform sampler2D u_mask2;
uniform vec2 u_texel;
uniform vec2 u_cropOffset;
uniform vec2 u_cropScale;
uniform float u_exposure;    // EV
uniform float u_contrast;    // -1..1
uniform float u_highlights;  // -1..1
uniform float u_shadows;     // -1..1
uniform float u_whites;      // -1..1
uniform float u_blacks;      // -1..1
uniform float u_temperature; // -1..1
uniform float u_tint;        // -1..1
uniform float u_vibrance;    // -1..1
uniform float u_saturation;  // -1..1
uniform float u_sharpness;   // 0..1
uniform float u_vignette;    // -1..1
uniform float u_grain;       // 0..1
uniform float u_hslHue[8];   // -1..1 (=> +-30 deg)
uniform float u_hslSat[8];   // -1..1
uniform float u_hslLum[8];   // -1..1
uniform int u_rotation;      // quarter turns
uniform int u_maskCount;
uniform vec4 u_maskA[3];     // exposure(EV), contrast, saturation, temperature
uniform vec4 u_maskB[3];     // shadows, invert, 0, 0

in vec2 v_uv;
out vec4 outColor;

const float BAND_HUES[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0);

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec2 rotateUV(vec2 uv, int quarter) {
  if (quarter == 1) return vec2(uv.y, 1.0 - uv.x);
  if (quarter == 2) return vec2(1.0 - uv.x, 1.0 - uv.y);
  if (quarter == 3) return vec2(1.0 - uv.y, uv.x);
  return uv;
}

vec3 applyMask(vec3 color, float m, vec4 A, vec4 B) {
  if (B.y > 0.5) m = 1.0 - m;
  if (m < 0.003) return color;
  color *= pow(2.0, A.x * m);                                        // exposure
  color = mix(color, (color - 0.5) * (1.0 + A.y * 0.8) + 0.5, m);    // contrast
  float t = A.w * 0.35 * m;                                          // temperature
  color.r *= 1.0 + t;
  color.b *= 1.0 - t;
  float lm = luma(clamp(color, 0.0, 1.0));                           // shadows
  color += B.x * 0.3 * (1.0 - smoothstep(0.0, 0.55, lm)) * (1.0 - clamp(color, 0.0, 1.0)) * m;
  float gr = luma(color);                                            // saturation
  color = mix(color, mix(vec3(gr), color, 1.0 + A.z), m);
  return color;
}

void main() {
  // display space (y-down) -> crop window -> rotated space -> texture space
  vec2 uvDisp = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 uvR = u_cropOffset + uvDisp * u_cropScale;
  vec2 uv = rotateUV(uvR, u_rotation);
  vec3 color = texture(u_image, uv).rgb;

  // --- Sharpening (unsharp mask on the source) ---
  if (u_sharpness > 0.001) {
    vec3 blur = vec3(0.0);
    blur += texture(u_image, uv + vec2(-u_texel.x, 0.0)).rgb;
    blur += texture(u_image, uv + vec2(u_texel.x, 0.0)).rgb;
    blur += texture(u_image, uv + vec2(0.0, -u_texel.y)).rgb;
    blur += texture(u_image, uv + vec2(0.0, u_texel.y)).rgb;
    blur *= 0.25;
    color += (color - blur) * u_sharpness * 1.5;
  }

  // --- White balance ---
  float t = u_temperature * 0.35;
  float g = u_tint * 0.25;
  color.r *= 1.0 + t;
  color.b *= 1.0 - t;
  color.g *= 1.0 + g;

  // --- Exposure ---
  color *= pow(2.0, u_exposure);

  // --- Highlights / Shadows / Whites / Blacks (luminance-masked) ---
  float lum = luma(clamp(color, 0.0, 4.0));
  float hlMask = smoothstep(0.45, 1.0, lum);
  float shMask = 1.0 - smoothstep(0.0, 0.55, lum);
  color *= 1.0 + u_highlights * 0.55 * hlMask;
  color += u_shadows * 0.28 * shMask * (1.0 - color);
  color *= 1.0 + u_whites * 0.25;
  color += u_blacks * 0.15 * (1.0 - smoothstep(0.0, 0.35, lum));

  // --- Contrast (pivot at mid-grey) ---
  color = (color - 0.5) * (1.0 + u_contrast * 0.8) + 0.5;

  // --- Tone curve (256-entry LUT) ---
  color = clamp(color, 0.0, 1.0);
  color = vec3(
    texture(u_curve, vec2(color.r, 0.5)).r,
    texture(u_curve, vec2(color.g, 0.5)).r,
    texture(u_curve, vec2(color.b, 0.5)).r
  );

  // --- HSL per-band ---
  vec3 hsv = rgb2hsv(clamp(color, 0.0, 1.0));
  float hueDeg = hsv.x * 360.0;
  float dH = 0.0;
  float dS = 0.0;
  float dL = 0.0;
  for (int i = 0; i < 8; i++) {
    float dist = abs(hueDeg - BAND_HUES[i]);
    dist = min(dist, 360.0 - dist);
    float w = max(0.0, 1.0 - dist / 45.0) * hsv.y; // weight by saturation
    dH += u_hslHue[i] * w;
    dS += u_hslSat[i] * w;
    dL += u_hslLum[i] * w;
  }
  hsv.x = fract(hsv.x + dH * (30.0 / 360.0) + 1.0);
  hsv.y = clamp(hsv.y * (1.0 + dS * 0.8), 0.0, 1.0);
  hsv.z = clamp(hsv.z * (1.0 + dL * 0.45), 0.0, 1.0);
  color = hsv2rgb(hsv);

  // --- Vibrance & saturation ---
  float grey = luma(color);
  float sat = rgb2hsv(color).y;
  float vibWeight = (1.0 - sat) * u_vibrance * 0.9;
  color = mix(vec3(grey), color, 1.0 + vibWeight + u_saturation);

  // --- Local masks (in rotated-image space, so crop keeps them anchored) ---
  if (u_maskCount > 0) color = applyMask(color, texture(u_mask0, uvR).r, u_maskA[0], u_maskB[0]);
  if (u_maskCount > 1) color = applyMask(color, texture(u_mask1, uvR).r, u_maskA[1], u_maskB[1]);
  if (u_maskCount > 2) color = applyMask(color, texture(u_mask2, uvR).r, u_maskA[2], u_maskB[2]);

  // --- Vignette (in output space) ---
  if (abs(u_vignette) > 0.001) {
    float dist = distance(v_uv, vec2(0.5)) * 1.4142;
    float vig = smoothstep(0.45, 1.1, dist);
    color *= 1.0 + u_vignette * 0.8 * vig;
  }

  // --- Grain ---
  if (u_grain > 0.001) {
    float n = hash(v_uv * 1000.0) - 0.5;
    color += n * u_grain * 0.12;
  }

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

const UNIFORM_NAMES = [
  'u_image', 'u_curve', 'u_mask0', 'u_mask1', 'u_mask2',
  'u_texel', 'u_cropOffset', 'u_cropScale',
  'u_exposure', 'u_contrast', 'u_highlights', 'u_shadows',
  'u_whites', 'u_blacks', 'u_temperature', 'u_tint', 'u_vibrance', 'u_saturation',
  'u_sharpness', 'u_vignette', 'u_grain', 'u_hslHue', 'u_hslSat', 'u_hslLum',
  'u_rotation', 'u_maskCount', 'u_maskA', 'u_maskB',
];

function makeTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

export class ProcessingEngine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('WebGL2 non disponible sur ce navigateur');
    this.gl = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {};
    for (const name of UNIFORM_NAMES) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }

    // Texture units: 0 image, 1 curve LUT, 2-4 masks.
    this.texture = makeTexture(gl);
    this.curveTexture = makeTexture(gl);
    this.maskTextures = [makeTexture(gl), makeTexture(gl), makeTexture(gl)];
    gl.uniform1i(this.uniforms.u_image, 0);
    gl.uniform1i(this.uniforms.u_curve, 1);
    gl.uniform1i(this.uniforms.u_mask0, 2);
    gl.uniform1i(this.uniforms.u_mask1, 3);
    gl.uniform1i(this.uniforms.u_mask2, 4);

    this.setCurve(buildCurveLUT(null)); // identity
    // 1x1 black placeholders so the samplers are always valid.
    const black = new Uint8Array([0, 0, 0, 255]);
    for (const tex of this.maskTextures) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, black);
    }
    gl.activeTexture(gl.TEXTURE0);

    this.imageWidth = 0;
    this.imageHeight = 0;
    this.maskCount = 0;
  }

  // source: ImageBitmap / HTMLCanvasElement / HTMLImageElement
  setImage(source) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.imageWidth = source.width;
    this.imageHeight = source.height;
  }

  // lut: Uint8Array(256), or null for identity
  setCurve(lut) {
    const gl = this.gl;
    const data = lut || buildCurveLUT(null);
    const rgba = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      rgba[i * 4] = data[i];
      rgba[i * 4 + 1] = data[i];
      rgba[i * 4 + 2] = data[i];
      rgba[i * 4 + 3] = 255;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.activeTexture(gl.TEXTURE0);
  }

  // canvases: array of grayscale canvases (rotated-image space), max 3
  setMasks(canvases) {
    const gl = this.gl;
    this.maskCount = Math.min(3, canvases.length);
    for (let i = 0; i < this.maskCount; i++) {
      gl.activeTexture(gl.TEXTURE2 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTextures[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvases[i]);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  render(adj, { ignoreCrop = false } = {}) {
    const gl = this.gl;
    const rotation = ((adj.rotation ?? 0) % 4 + 4) % 4;
    const swap = rotation % 2 === 1;
    const rw = swap ? this.imageHeight : this.imageWidth;
    const rh = swap ? this.imageWidth : this.imageHeight;
    const crop = !ignoreCrop && adj.crop ? adj.crop : null;
    const outW = Math.max(1, Math.round(rw * (crop ? crop.w : 1)));
    const outH = Math.max(1, Math.round(rh * (crop ? crop.h : 1)));
    if (this.canvas.width !== outW || this.canvas.height !== outH) {
      this.canvas.width = outW;
      this.canvas.height = outH;
    }
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(this.program);

    const u = this.uniforms;
    // Re-bind all texture units (other engine instances may share the context pool).
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE2 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTextures[i]);
    }
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform2f(u.u_texel, 1 / this.imageWidth, 1 / this.imageHeight);
    gl.uniform2f(u.u_cropOffset, crop ? crop.x : 0, crop ? crop.y : 0);
    gl.uniform2f(u.u_cropScale, crop ? crop.w : 1, crop ? crop.h : 1);
    gl.uniform1f(u.u_exposure, adj.exposure ?? 0);
    gl.uniform1f(u.u_contrast, (adj.contrast ?? 0) / 100);
    gl.uniform1f(u.u_highlights, (adj.highlights ?? 0) / 100);
    gl.uniform1f(u.u_shadows, (adj.shadows ?? 0) / 100);
    gl.uniform1f(u.u_whites, (adj.whites ?? 0) / 100);
    gl.uniform1f(u.u_blacks, (adj.blacks ?? 0) / 100);
    gl.uniform1f(u.u_temperature, (adj.temperature ?? 0) / 100);
    gl.uniform1f(u.u_tint, (adj.tint ?? 0) / 100);
    gl.uniform1f(u.u_vibrance, (adj.vibrance ?? 0) / 100);
    gl.uniform1f(u.u_saturation, (adj.saturation ?? 0) / 100);
    gl.uniform1f(u.u_sharpness, (adj.sharpness ?? 0) / 100);
    gl.uniform1f(u.u_vignette, (adj.vignette ?? 0) / 100);
    gl.uniform1f(u.u_grain, (adj.grain ?? 0) / 100);
    gl.uniform1i(u.u_rotation, rotation);

    const hue = new Float32Array(8);
    const sat = new Float32Array(8);
    const lum = new Float32Array(8);
    HSL_BANDS.forEach((band, i) => {
      const v = adj.hsl?.[band.key] || {};
      hue[i] = (v.hue ?? 0) / 100;
      sat[i] = (v.sat ?? 0) / 100;
      lum[i] = (v.lum ?? 0) / 100;
    });
    gl.uniform1fv(u.u_hslHue, hue);
    gl.uniform1fv(u.u_hslSat, sat);
    gl.uniform1fv(u.u_hslLum, lum);

    // Per-mask local adjustments.
    const masks = (adj.masks || []).slice(0, 3);
    const count = Math.min(this.maskCount, masks.length);
    gl.uniform1i(u.u_maskCount, count);
    const A = new Float32Array(12);
    const B = new Float32Array(12);
    masks.forEach((m, i) => {
      const a = m.adjustments || {};
      A[i * 4] = a.exposure ?? 0;                    // EV directly
      A[i * 4 + 1] = (a.contrast ?? 0) / 100;
      A[i * 4 + 2] = (a.saturation ?? 0) / 100;
      A[i * 4 + 3] = (a.temperature ?? 0) / 100;
      B[i * 4] = (a.shadows ?? 0) / 100;
      B[i * 4 + 1] = m.invert ? 1 : 0;
    });
    gl.uniform4fv(u.u_maskA, A);
    gl.uniform4fv(u.u_maskB, B);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy() {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteTexture(this.curveTexture);
    for (const t of this.maskTextures) gl.deleteTexture(t);
    gl.deleteProgram(this.program);
  }
}

// Computes 256-bin luminance + RGB histograms from a canvas (downsampled).
export function computeHistogram(sourceCanvas) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
    l[Math.round(data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722)]++;
  }
  return { r, g, b, l };
}

// Shared helper: configures curve + masks on an engine for one-shot renders
// (export, reel). `source` is the T-space image (canvas or bitmap).
export function configureEngineExtras(engine, adjustments, source) {
  engine.setCurve(buildCurveLUT(adjustments.curve));
  const masks = (adjustments.masks || []).slice(0, 3);
  engine.setMasks(masks.length > 0 ? rasterizeMasks(masks, source, adjustments.rotation ?? 0) : []);
  return Promise.resolve();
}
