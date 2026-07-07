// One-click automatic dust & blemish removal.
// Pipeline: local anomaly detection (difference from a box-blurred base),
// connected-component filtering (only small isolated blobs qualify as dust),
// then inpainting via normalized (mask-weighted) separable blur.

function boxBlurGray(src, W, H, r) {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const win = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc / win;
      acc += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / win;
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

function dilate(mask, W, H, iterations) {
  for (let it = 0; it < iterations; it++) {
    const src = mask.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (src[i]) continue;
        if (
          (x > 0 && src[i - 1]) || (x < W - 1 && src[i + 1]) ||
          (y > 0 && src[i - W]) || (y < H - 1 && src[i + W])
        ) mask[i] = 1;
      }
    }
  }
}

export async function removeDustFromBlob(blob, { maxDim = 3200, threshold = 15 } = {}) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const W = Math.max(1, Math.round(bitmap.width * scale));
  const H = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, W, H);
  bitmap.close();

  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const N = W * H;

  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    lum[i] = d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722;
  }
  const base = boxBlurGray(lum, W, H, 6);

  // Candidate mask: pixels deviating strongly from their neighborhood.
  const mask = new Uint8Array(N);
  let candidates = 0;
  for (let i = 0; i < N; i++) {
    if (Math.abs(lum[i] - base[i]) > threshold) {
      mask[i] = 1;
      candidates++;
    }
  }
  if (candidates === 0) return { blob, count: 0, changed: false };

  // Keep only dust-like components: small area, compact bounding box.
  // Large deviating regions are real image content (edges, subjects).
  const MAX_AREA = Math.max(80, Math.round(N * 0.0006));
  const MAX_BOX = Math.max(24, Math.round(Math.max(W, H) * 0.035));
  // Hairs/fibers: thin elongated components are dust too, allow longer boxes.
  // Thickness threshold accounts for the JPEG halo around thin strokes.
  const THIN = Math.max(8, Math.round(Math.max(W, H) * 0.011));
  const MAX_LONG = Math.round(Math.max(W, H) * 0.18);
  const labels = new Uint8Array(N);
  const stack = new Int32Array(N);
  let count = 0;

  for (let seed = 0; seed < N; seed++) {
    if (mask[seed] !== 1 || labels[seed]) continue;
    let head = 0;
    let tail = 0;
    stack[tail++] = seed;
    labels[seed] = 1;
    const px = [];
    let minX = W, maxX = 0, minY = H, maxY = 0;
    while (head < tail) {
      const j = stack[head++];
      px.push(j);
      const x = j % W;
      const y = (j / W) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[j - 1] === 1 && !labels[j - 1]) { labels[j - 1] = 1; stack[tail++] = j - 1; }
      if (x < W - 1 && mask[j + 1] === 1 && !labels[j + 1]) { labels[j + 1] = 1; stack[tail++] = j + 1; }
      if (y > 0 && mask[j - W] === 1 && !labels[j - W]) { labels[j - W] = 1; stack[tail++] = j - W; }
      if (y < H - 1 && mask[j + W] === 1 && !labels[j + W]) { labels[j + W] = 1; stack[tail++] = j + W; }
    }
    const area = px.length;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const compact = area <= MAX_AREA && bw <= MAX_BOX && bh <= MAX_BOX;
    // Mean stroke thickness = area / longest dimension: hairs stay thin even
    // when their curved bounding box is large.
    const thinElongated =
      area / Math.max(bw, bh) <= THIN &&
      Math.max(bw, bh) >= 2.2 * Math.min(bw, bh) &&
      Math.max(bw, bh) <= MAX_LONG &&
      area <= MAX_AREA * 3;
    if (area >= 3 && (compact || thinElongated)) {
      count++;
      for (const j of px) mask[j] = 2;
    }
  }
  if (count === 0) return { blob, count: 0, changed: false };

  const fin = new Uint8Array(N);
  for (let i = 0; i < N; i++) fin[i] = mask[i] === 2 ? 1 : 0;
  dilate(fin, W, H, 2);

  // Normalized blur inpainting: average of surrounding non-masked pixels.
  const wArr = new Float32Array(N);
  const rC = new Float32Array(N);
  const gC = new Float32Array(N);
  const bC = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const w = fin[i] ? 0 : 1;
    wArr[i] = w;
    rC[i] = d[i * 4] * w;
    gC[i] = d[i * 4 + 1] * w;
    bC[i] = d[i * 4 + 2] * w;
  }
  const R = 10;
  const wB = boxBlurGray(wArr, W, H, R);
  const rB = boxBlurGray(rC, W, H, R);
  const gB = boxBlurGray(gC, W, H, R);
  const bB = boxBlurGray(bC, W, H, R);
  for (let i = 0; i < N; i++) {
    if (!fin[i]) continue;
    const ws = wB[i];
    if (ws > 1e-4) {
      d[i * 4] = rB[i] / ws;
      d[i * 4 + 1] = gB[i] / ws;
      d[i * 4 + 2] = bB[i] / ws;
    }
  }

  ctx.putImageData(img, 0, 0);
  const out = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encodage retouche impossible'))), 'image/jpeg', 0.92);
  });
  return { blob: out, count, changed: true };
}
