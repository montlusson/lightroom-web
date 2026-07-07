// Assisted portrait culling: detects faces (native FaceDetector when the
// browser provides it, otherwise a skin-tone blob heuristic) and scores each
// photo on eye sharpness (local Laplacian variance in the eye band) and
// eyes-open likelihood (dark pupil clusters with sufficient vertical extent).

const ANALYZE_DIM = 700;

function detectSkinFaces(img) {
  const { data, width: W, height: H } = img;
  const step = 2;
  const w = Math.floor(W / step);
  const h = Math.floor(H / step);
  const skin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * step * W + x * step) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b) {
        skin[y * w + x] = 1;
      }
    }
  }
  // Connected components on the skin mask.
  const labels = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const boxes = [];
  for (let seed = 0; seed < w * h; seed++) {
    if (!skin[seed] || labels[seed]) continue;
    let head = 0, tail = 0;
    stack[tail++] = seed;
    labels[seed] = 1;
    let area = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    while (head < tail) {
      const j = stack[head++];
      area++;
      const x = j % w, y = (j / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && skin[j - 1] && !labels[j - 1]) { labels[j - 1] = 1; stack[tail++] = j - 1; }
      if (x < w - 1 && skin[j + 1] && !labels[j + 1]) { labels[j + 1] = 1; stack[tail++] = j + 1; }
      if (y > 0 && skin[j - w] && !labels[j - w]) { labels[j - w] = 1; stack[tail++] = j - w; }
      if (y < h - 1 && skin[j + w] && !labels[j + w]) { labels[j + w] = 1; stack[tail++] = j + w; }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const fill = area / (bw * bh);
    const aspect = bh / bw;
    // Faces are compact ovals that rarely touch two image borders.
    const borderTouches =
      (minX === 0 ? 1 : 0) + (maxX === w - 1 ? 1 : 0) + (minY === 0 ? 1 : 0) + (maxY === h - 1 ? 1 : 0);
    if (
      area > w * h * 0.005 && area < w * h * 0.6 &&
      aspect > 0.75 && aspect < 2.1 && fill > 0.4 && borderTouches < 2
    ) {
      boxes.push({ x: minX * step, y: minY * step, w: bw * step, h: bh * step });
    }
  }
  return boxes;
}

function grayRegion(img, x0, y0, rw, rh) {
  const { data, width: W, height: H } = img;
  x0 = Math.max(0, Math.round(x0));
  y0 = Math.max(0, Math.round(y0));
  rw = Math.min(W - x0, Math.round(rw));
  rh = Math.min(H - y0, Math.round(rh));
  const out = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = ((y0 + y) * W + x0 + x) * 4;
      out[y * rw + x] = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    }
  }
  return { g: out, w: rw, h: rh };
}

function scoreFace(img, box) {
  // Eye band: between 25% and 55% of face height.
  const band = grayRegion(img, box.x + box.w * 0.08, box.y + box.h * 0.25, box.w * 0.84, box.h * 0.3);
  const { g, w, h } = band;
  if (w < 8 || h < 6) return { score: 0, eyeSharpness: 0, eyesOpen: 0 };

  // Sharpness: variance of the 4-neighbor Laplacian over the eye band.
  let lapSum = 0, lapSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const lapVar = lapSq / n - (lapSum / n) ** 2;
  const eyeSharpness = Math.round(Math.min(100, Math.sqrt(lapVar) * 5));

  // Eyes open: dark pupil clusters (well below band mean) in both halves,
  // with enough vertical extent (a closed eye reads as a thin dark line).
  let mean = 0;
  for (let i = 0; i < g.length; i++) mean += g[i];
  mean /= g.length;
  const darkThr = mean - 45;
  const halves = [0, 1].map((half) => {
    const xStart = half === 0 ? 0 : Math.floor(w / 2);
    const xEnd = half === 0 ? Math.floor(w / 2) : w;
    let dark = 0;
    let maxRun = 0;
    // An open eye shows a tall dark cluster (pupil/iris); a closed lid or an
    // eyebrow is only a thin dark line. Measure the tallest contiguous dark
    // run per column so thin lines cannot add up across the band.
    for (let x = xStart; x < xEnd; x++) {
      let run = 0;
      for (let y = 0; y < h; y++) {
        if (g[y * w + x] < darkThr) {
          dark++;
          run++;
          if (run > maxRun) maxRun = run;
        } else {
          run = 0;
        }
      }
    }
    if (dark === 0) return 0;
    const presence = Math.min(1, dark / ((xEnd - xStart) * h * 0.02));
    const runRatio = maxRun / h;
    const extent = Math.max(0, Math.min(1, (runRatio - 0.05) / 0.08));
    return presence * extent;
  });
  const eyesOpen = Math.round(100 * ((halves[0] + halves[1]) / 2) * (halves[0] > 0.1 && halves[1] > 0.1 ? 1 : 0.4));

  const score = Math.round(0.55 * eyesOpen + 0.45 * eyeSharpness);
  return { score, eyeSharpness, eyesOpen };
}

export async function analyzeFaces(blob) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, ANALYZE_DIM / Math.max(bitmap.width, bitmap.height));
  const W = Math.max(1, Math.round(bitmap.width * scale));
  const H = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, W, H);
  bitmap.close();
  const img = ctx.getImageData(0, 0, W, H);

  let boxes = [];
  if (typeof window !== 'undefined' && 'FaceDetector' in window) {
    try {
      const fd = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 8 });
      const found = await fd.detect(canvas);
      boxes = found.map((f) => ({
        x: f.boundingBox.x, y: f.boundingBox.y, w: f.boundingBox.width, h: f.boundingBox.height,
      }));
    } catch { /* native detector unavailable at runtime: fall back */ }
  }
  if (boxes.length === 0) boxes = detectSkinFaces(img);
  if (boxes.length === 0) {
    return { faces: 0, score: 0, eyeSharpness: 0, eyesOpen: 0, analyzedAt: Date.now() };
  }

  let best = null;
  for (const box of boxes) {
    const s = scoreFace(img, box);
    if (!best || s.score > best.score) best = s;
  }
  return { faces: boxes.length, ...best, analyzedAt: Date.now() };
}
