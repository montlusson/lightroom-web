// Full-resolution export: renders the master image through the WebGL engine
// at native resolution (optionally resized), then encodes to the target format.

import { ProcessingEngine, configureEngineExtras } from './engine';

export const EXPORT_FORMATS = [
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', hasQuality: true },
  { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png', hasQuality: false },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', hasQuality: true },
];

const MAX_GL_DIM = 8192;

export async function renderExportBlob(masterBlob, adjustments, options) {
  const { format = 'jpeg', quality = 0.9, maxDimension = 0 } = options;
  const fmt = EXPORT_FORMATS.find((f) => f.id === format) || EXPORT_FORMATS[0];

  const bitmap = await createImageBitmap(masterBlob, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, MAX_GL_DIM / Math.max(bitmap.width, bitmap.height));
    const glCanvas = document.createElement('canvas');
    const engine = new ProcessingEngine(glCanvas);

    let source = bitmap;
    if (scale < 1) {
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(bitmap.width * scale);
      tmp.height = Math.round(bitmap.height * scale);
      tmp.getContext('2d').drawImage(bitmap, 0, 0, tmp.width, tmp.height);
      source = tmp;
    }
    engine.setImage(source);
    await configureEngineExtras(engine, adjustments, source);
    engine.render(adjustments);

    // Optional resize to maxDimension on the longest edge.
    let outCanvas = glCanvas;
    if (maxDimension > 0 && Math.max(glCanvas.width, glCanvas.height) > maxDimension) {
      const rScale = maxDimension / Math.max(glCanvas.width, glCanvas.height);
      const resized = document.createElement('canvas');
      resized.width = Math.round(glCanvas.width * rScale);
      resized.height = Math.round(glCanvas.height * rScale);
      const ctx = resized.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(glCanvas, 0, 0, resized.width, resized.height);
      outCanvas = resized;
    }

    const blob = await new Promise((resolve, reject) => {
      outCanvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error(`Encodage ${fmt.label} impossible`))),
        fmt.mime,
        fmt.hasQuality ? quality : undefined
      );
    });
    engine.destroy();
    return { blob, width: outCanvas.width, height: outCanvas.height, ext: fmt.ext };
  } finally {
    bitmap.close();
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function baseName(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
