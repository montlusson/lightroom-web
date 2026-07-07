// Smart masking: mask descriptors live in adjustments.masks (max 3), each
// with local adjustments applied by the shader. Masks are rasterized to
// grayscale canvases in rotated-image space:
//  - radial / linear: analytic canvas gradients
//  - subject / sky (AI): heuristics computed from the image itself, cached
//    per photo by the caller (deterministic, so nothing to persist).

export const MAX_MASKS = 3;

export const MASK_TYPES = [
  { id: 'subject', label: 'Sujet (IA)', icon: '◉' },
  { id: 'sky', label: 'Ciel (IA)', icon: '☁' },
  { id: 'radial', label: 'Radial', icon: '◯' },
  { id: 'linear', label: 'Linéaire', icon: '▤' },
];

let maskSeq = 0;

export function createMask(type) {
  const base = {
    id: `m_${Date.now()}_${maskSeq++}`,
    type,
    invert: false,
    adjustments: { exposure: 0, contrast: 0, shadows: 0, saturation: 0, temperature: 0 },
  };
  if (type === 'radial') {
    base.params = { cx: 0.5, cy: 0.5, rx: 0.35, ry: 0.3, feather: 0.5 };
  } else if (type === 'linear') {
    base.params = { cx: 0.5, cy: 0.3, angle: 90, range: 0.5 };
  } else {
    base.params = {};
  }
  return base;
}

export function maskLabel(mask, index) {
  const t = MASK_TYPES.find((x) => x.id === mask.type);
  return `${t ? t.label : mask.type} ${index + 1}`;
}

function toSmallCanvas(source, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(source.width, source.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(source.width * scale));
  c.height = Math.max(1, Math.round(source.height * scale));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function boxBlurMask(v, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += v[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / win;
      acc += v[y * w + Math.min(w - 1, x + r + 1)] - v[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function valuesToCanvas(v, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const g = Math.round(Math.max(0, Math.min(1, v[i])) * 255);
    img.data[i * 4] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Subject selection heuristic: saliency = color distance to the border
// (background estimate) weighted by a center prior, softly thresholded.
export function computeSubjectMask(source) {
  const c = toSmallCanvas(source, 160);
  const w = c.width, h = c.height;
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;

  // Background estimate: mean color of the outer 8% frame.
  const bw = Math.max(2, Math.round(Math.min(w, h) * 0.08));
  let br = 0, bg = 0, bb = 0, bn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < bw || x >= w - bw || y < bw || y >= h - bw) {
        const i = (y * w + x) * 4;
        br += d[i]; bg += d[i + 1]; bb += d[i + 2]; bn++;
      }
    }
  }
  br /= bn; bg /= bn; bb /= bn;

  const score = new Float32Array(w * h);
  let maxScore = 1e-6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dist = Math.sqrt((d[i] - br) ** 2 + (d[i + 1] - bg) ** 2 + (d[i + 2] - bb) ** 2) / 441;
      const nx = (x / w - 0.5) * 2;
      const ny = (y / h - 0.5) * 2;
      const center = Math.exp(-(nx * nx + ny * ny) * 1.1);
      const s = dist * (0.35 + 0.65 * center);
      score[y * w + x] = s;
      if (s > maxScore) maxScore = s;
    }
  }
  const mask = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const t = score[i] / maxScore;
    mask[i] = t <= 0.22 ? 0 : t >= 0.5 ? 1 : (t - 0.22) / 0.28; // soft threshold
  }
  return valuesToCanvas(boxBlurMask(mask, w, h, 2), w, h);
}

// Sky selection heuristic: columns scanned from the top edge while pixels
// stay similar to the top-region statistics (bright/blue, smooth).
export function computeSkyMask(source) {
  const c = toSmallCanvas(source, 160);
  const w = c.width, h = c.height;
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;

  // Top 12% stats.
  const th = Math.max(2, Math.round(h * 0.12));
  let tr = 0, tg = 0, tb = 0, tn = 0;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      tr += d[i]; tg += d[i + 1]; tb += d[i + 2]; tn++;
    }
  }
  tr /= tn; tg /= tn; tb /= tn;

  const mask = new Float32Array(w * h);
  const tol = 70;
  for (let x = 0; x < w; x++) {
    let misses = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      // Follow the vertical sky gradient: compare against a blend of the
      // top stats and the previous row's accepted color.
      const dist = Math.sqrt((d[i] - tr) ** 2 + (d[i + 1] - tg) ** 2 + (d[i + 2] - tb) ** 2);
      const gradTol = tol + y / h * 120; // sky gradients drift with altitude
      if (dist < gradTol) {
        mask[y * w + x] = 1;
        misses = 0;
      } else {
        misses++;
        if (misses > Math.max(2, h * 0.02)) break; // solid obstacle: stop column
      }
    }
  }
  return valuesToCanvas(boxBlurMask(mask, w, h, 2), w, h);
}

// Draws a T-space (unrotated) canvas into an R-space (rotated) canvas
// following the same quarter-turn convention as the WebGL engine.
function drawRotated(ctx, source, rotation, W, H) {
  ctx.save();
  if (rotation === 1) {
    ctx.translate(W, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(source, 0, 0, H, W);
  } else if (rotation === 2) {
    ctx.translate(W, H);
    ctx.rotate(Math.PI);
    ctx.drawImage(source, 0, 0, W, H);
  } else if (rotation === 3) {
    ctx.translate(0, H);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(source, 0, 0, H, W);
  } else {
    ctx.drawImage(source, 0, 0, W, H);
  }
  ctx.restore();
}

// Rasterizes every mask to a grayscale canvas in rotated-image space.
// - masks: adjustments.masks
// - source: T-space canvas/bitmap of the image (used for AI masks)
// - rotation: quarter turns
// - aiCache: optional Map to reuse AI computations (key: mask type)
export function rasterizeMasks(masks, source, rotation, aiCache = null, outSize = 512) {
  const swap = rotation % 2 === 1;
  const rw = swap ? source.height : source.width;
  const rh = swap ? source.width : source.height;
  const scale = Math.min(1, outSize / Math.max(rw, rh));
  const W = Math.max(1, Math.round(rw * scale));
  const H = Math.max(1, Math.round(rh * scale));

  return masks.slice(0, MAX_MASKS).map((mask) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    if (mask.type === 'radial') {
      const { cx, cy, rx, ry, feather } = mask.params;
      ctx.save();
      ctx.translate(cx * W, cy * H);
      ctx.scale(Math.max(0.01, rx) * W, Math.max(0.01, ry) * H);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      const inner = Math.max(0, Math.min(0.98, 1 - (feather ?? 0.5)));
      g.addColorStop(0, '#fff');
      g.addColorStop(inner, '#fff');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    } else if (mask.type === 'linear') {
      const { cx, cy, angle, range } = mask.params;
      const rad = ((angle ?? 90) * Math.PI) / 180;
      const dxv = Math.cos(rad);
      const dyv = Math.sin(rad);
      const len = (Math.max(0.02, range ?? 0.5) * Math.max(W, H)) / 2;
      const sx = cx * W - dxv * len;
      const sy = cy * H - dyv * len;
      const ex = cx * W + dxv * len;
      const ey = cy * H + dyv * len;
      const g = ctx.createLinearGradient(sx, sy, ex, ey);
      g.addColorStop(0, '#fff');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if (mask.type === 'subject' || mask.type === 'sky') {
      let ai = aiCache?.get(mask.type);
      if (!ai) {
        ai = mask.type === 'subject' ? computeSubjectMask(source) : computeSkyMask(source);
        aiCache?.set(mask.type, ai);
      }
      drawRotated(ctx, ai, ((rotation % 4) + 4) % 4, W, H);
    }
    return c;
  });
}
