// Tone curve: monotone cubic interpolation (Fritsch-Carlson) through the
// user's control points, baked into a 256-entry LUT consumed by the shader.

import { DEFAULT_CURVE_POINTS } from './adjustments';

// points: [{x, y}] sorted by x, values in 0..1. Returns f(x) -> y.
export function monotoneCubic(points) {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const n = pts.length;
  if (n === 0) return (x) => x;
  if (n === 1) return () => pts[0].y;

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const dx = [];
  const slopes = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i] || 1e-6;
    dx.push(h);
    slopes.push((ys[i + 1] - ys[i]) / h);
  }
  const m = [slopes[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) m.push(0);
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m.push((w1 + w2) / (w1 / slopes[i - 1] + w2 / slopes[i]));
    }
  }
  m.push(slopes[n - 2]);

  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const t = (x - xs[i]) / dx[i];
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * ys[i] + h10 * dx[i] * m[i] + h01 * ys[i + 1] + h11 * dx[i] * m[i + 1];
  };
}

// Returns a 256-byte LUT (input level -> output level).
export function buildCurveLUT(curve) {
  const points = curve?.points?.length >= 2 ? curve.points : DEFAULT_CURVE_POINTS;
  const f = monotoneCubic(points);
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(Math.max(0, Math.min(1, f(i / 255))) * 255);
  }
  return lut;
}
