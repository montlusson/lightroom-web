// Duplicate detection via perceptual hashing (dHash 8x8 on luminance
// gradients) + Hamming distance grouping with union-find.

export async function computeDHash(blob) {
  // 9x9 grid gives both horizontal and vertical gradient hashes; a color
  // signature disambiguates smooth gradients that fool luminance-only hashes.
  const S = 9;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, S, S);
  bitmap.close();
  const d = ctx.getImageData(0, 0, S, S).data;
  const lum = (x, y) => {
    const i = (y * S + x) * 4;
    return d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
  };
  let hash = '';
  // Horizontal gradients (8x8 = 64 bits)
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (lum(x, y) > lum(x + 1, y) ? 1 : 0);
    hash += byte.toString(16).padStart(2, '0');
  }
  // Vertical gradients (8x8 = 64 bits)
  for (let x = 0; x < 8; x++) {
    let byte = 0;
    for (let y = 0; y < 8; y++) byte = (byte << 1) | (lum(x, y) > lum(x, y + 1) ? 1 : 0);
    hash += byte.toString(16).padStart(2, '0');
  }
  // Color signature: 4x4 cells, R and B channels vs global mean (32 bits)
  let meanR = 0, meanB = 0;
  for (let i = 0; i < S * S; i++) { meanR += d[i * 4]; meanB += d[i * 4 + 2]; }
  meanR /= S * S;
  meanB /= S * S;
  let bits = 0, nb = 0;
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      const i = ((cy * 2 + 1) * S + cx * 2 + 1) * 4;
      bits = (bits << 1) | (d[i] > meanR ? 1 : 0);
      bits = (bits << 1) | (d[i + 2] > meanB ? 1 : 0);
      nb += 2;
      if (nb === 8) { hash += bits.toString(16).padStart(2, '0'); bits = 0; nb = 0; }
    }
  }
  return hash; // 40 hex chars = 160 bits
}

export function hammingHex(a, b) {
  const len = Math.min(a.length, b.length);
  let dist = 0;
  for (let i = 0; i < len; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  // Hashes of different lengths (old cached format) never match closely.
  return dist + Math.abs(a.length - b.length) * 4;
}

// entries: [{ id, hash }] -> array of groups (arrays of ids, length >= 2)
export function groupByHash(entries, maxDist = 9) {
  const parent = new Map(entries.map((e) => [e.id, e.id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (hammingHex(entries[i].hash, entries[j].hash) <= maxDist) {
        parent.set(find(entries[i].id), find(entries[j].id));
      }
    }
  }
  const groups = new Map();
  for (const e of entries) {
    const root = find(e.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(e.id);
  }
  return [...groups.values()].filter((g) => g.length >= 2);
}
