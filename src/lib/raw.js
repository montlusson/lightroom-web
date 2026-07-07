// RAW file support: extracts the highest-resolution embedded JPEG preview.
// Most RAW formats (DNG, CR2, NEF, ARW, ORF, RW2, PEF, SRW, RAF, CR3) embed
// one or more full JPEG previews. We scan the container for JPEG streams,
// parse their segment structure to find the exact end, and keep the largest.

export const RAW_EXTENSIONS = new Set([
  'dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2',
  'orf', 'rw2', 'raf', 'pef', 'srw', 'raw', 'rwl', 'dcr', 'kdc',
  '3fr', 'fff', 'iiq', 'mos', 'erf', 'mef', 'mrw', 'x3f',
]);

export function fileExtension(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function isRawFile(file) {
  return RAW_EXTENSIONS.has(fileExtension(file.name));
}

// Walks JPEG marker segments starting at `start` (must point at FFD8).
// Returns the offset just after the final FFD9, or -1 if the stream is invalid.
function jpegEndOffset(bytes, start) {
  let p = start + 2; // skip SOI
  const len = bytes.length;
  while (p + 4 <= len) {
    if (bytes[p] !== 0xff) return -1;
    const marker = bytes[p + 1];
    if (marker === 0xd8) return -1; // nested SOI: malformed
    if (marker === 0xd9) return p + 2;
    if (marker === 0xda) {
      // Start of scan: entropy-coded data until EOI. Skip stuffed FF00 and
      // restart markers FFD0-FFD7.
      p += 2 + ((bytes[p + 2] << 8) | bytes[p + 3]);
      while (p + 1 < len) {
        if (bytes[p] === 0xff) {
          const m = bytes[p + 1];
          if (m === 0xd9) return p + 2;
          if (m === 0x00 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
          if (m === 0xff) { p += 1; continue; }
          // Unexpected marker inside scan (e.g. next segment in multi-scan)
          p += 2;
          continue;
        }
        p += 1;
      }
      return -1;
    }
    if (marker >= 0xd0 && marker <= 0xd7) { p += 2; continue; }
    const segLen = (bytes[p + 2] << 8) | bytes[p + 3];
    if (segLen < 2) return -1;
    p += 2 + segLen;
  }
  return -1;
}

// Finds all embedded JPEG streams and returns the byte range of the largest.
function findLargestJpeg(bytes) {
  const candidates = [];
  const len = bytes.length;
  for (let i = 0; i + 3 < len; i++) {
    // JPEG SOI followed by a marker byte (FFD8 FFxx)
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      const markerByte = bytes[i + 3];
      // Valid first markers: APPn (E0-EF), DQT (DB), SOF (C0-CF), COM (FE)
      if ((markerByte >= 0xc0 && markerByte <= 0xfe)) {
        const end = jpegEndOffset(bytes, i);
        if (end > i + 2000) { // ignore tiny thumbnails (< 2 KB)
          candidates.push({ start: i, end, size: end - i });
          i = end - 1; // skip past this stream
        }
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.size - a.size);
  return candidates[0];
}

// Extracts the best embedded preview from a RAW file as a JPEG Blob.
// Throws if no usable preview is found.
export async function extractRawPreview(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const best = findLargestJpeg(bytes);
  if (!best) {
    throw new Error(`Aucun aperçu JPEG trouvé dans « ${file.name} »`);
  }
  const blob = new Blob([bytes.subarray(best.start, best.end)], { type: 'image/jpeg' });
  // Validate that the browser can actually decode it.
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  if (width < 32 || height < 32) {
    throw new Error(`Aperçu trop petit dans « ${file.name} »`);
  }
  return blob;
}
