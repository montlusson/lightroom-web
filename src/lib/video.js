// Reel / slideshow video rendering: processed stills are pre-rendered through
// the WebGL engine, then animated (Ken Burns + crossfades) on a 2D canvas
// captured in real time by MediaRecorder.

import { ProcessingEngine, configureEngineExtras } from './engine';
import { masterOf } from './photo';

export const REEL_FORMATS = [
  { id: 'reel', label: 'Reel vertical 9:16 (1080×1920)', width: 1080, height: 1920 },
  { id: 'square', label: 'Carré 1:1 (1080×1080)', width: 1080, height: 1080 },
  { id: 'wide', label: 'Paysage 16:9 (1920×1080)', width: 1920, height: 1080 },
];

export function pickVideoCodec() {
  const candidates = [
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  if (typeof MediaRecorder === 'undefined') return null;
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mime)) || null;
}

export async function renderReel(photos, options = {}, { onProgress, previewCanvas } = {}) {
  const {
    width = 1080,
    height = 1920,
    secondsPerPhoto = 2.5,
    transitionSeconds = 0.6,
    kenBurns = true,
    fps = 30,
  } = options;
  if (photos.length === 0) throw new Error('Aucune photo sélectionnée');
  const codec = pickVideoCodec();
  if (!codec) throw new Error('Enregistrement vidéo non pris en charge par ce navigateur');

  // Pre-render every photo with its develop adjustments applied.
  const glCanvas = document.createElement('canvas');
  const engine = new ProcessingEngine(glCanvas);
  const stills = [];
  try {
    for (const p of photos) {
      const bmp = await createImageBitmap(masterOf(p), { imageOrientation: 'from-image' });
      const s = Math.min(1, (Math.max(width, height) * 1.3) / Math.max(bmp.width, bmp.height));
      let source = bmp;
      if (s < 1) {
        const tmp = document.createElement('canvas');
        tmp.width = Math.round(bmp.width * s);
        tmp.height = Math.round(bmp.height * s);
        tmp.getContext('2d').drawImage(bmp, 0, 0, tmp.width, tmp.height);
        source = tmp;
      }
      engine.setImage(source);
      await configureEngineExtras(engine, p.adjustments || {}, source);
      engine.render(p.adjustments || {});
      stills.push(await createImageBitmap(glCanvas));
      bmp.close();
    }
  } finally {
    engine.destroy();
  }

  const canvas = previewCanvas || document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const total = photos.length * secondsPerPhoto;

  function drawCover(img, t01, forward) {
    const zoom = kenBurns ? 1.04 + 0.07 * (forward ? t01 : 1 - t01) : 1;
    const s = Math.max(width / img.width, height / img.height) * zoom;
    const dw = img.width * s;
    const dh = img.height * s;
    const panX = kenBurns ? (forward ? -1 : 1) * (t01 - 0.5) * 0.04 * width : 0;
    ctx.drawImage(img, (width - dw) / 2 + panX, (height - dh) / 2, dw, dh);
  }

  function drawFrame(t) {
    const idx = Math.min(photos.length - 1, Math.floor(t / secondsPerPhoto));
    const local = t - idx * secondsPerPhoto;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    drawCover(stills[idx], Math.min(1, local / secondsPerPhoto), idx % 2 === 0);
    const fadeStart = secondsPerPhoto - transitionSeconds;
    if (idx < photos.length - 1 && transitionSeconds > 0 && local > fadeStart) {
      ctx.globalAlpha = Math.min(1, (local - fadeStart) / transitionSeconds);
      drawCover(stills[idx + 1], 0, (idx + 1) % 2 === 0);
      ctx.globalAlpha = 1;
    }
  }

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: codec.mime,
    videoBitsPerSecond: 10_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

  drawFrame(0);
  recorder.start(250);
  const t0 = performance.now();
  const frameInterval = 1000 / fps;
  // setTimeout (not requestAnimationFrame): rAF freezes entirely in hidden
  // tabs, which would stall the recording timeline.
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) {
        drawFrame(total - 0.001);
        resolve();
        return;
      }
      drawFrame(t);
      onProgress?.(Math.min(1, t / total));
      setTimeout(tick, frameInterval);
    };
    setTimeout(tick, frameInterval);
  });
  recorder.stop();
  await stopped;
  stills.forEach((s) => s.close());
  onProgress?.(1);

  const blob = new Blob(chunks, { type: codec.mime.split(';')[0] });
  if (blob.size === 0) throw new Error('La capture vidéo a produit un fichier vide');
  return { blob, ext: codec.ext, duration: total };
}
