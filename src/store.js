// Global application state (Zustand). Photos are hydrated from IndexedDB at
// startup; blobs get object URLs for display. Adjustments are persisted with
// a short debounce while sliders move.

import { create } from 'zustand';
import * as db from './lib/db';
import { extractRawPreview, isRawFile, fileExtension } from './lib/raw';
import { DEFAULT_ADJUSTMENTS, cloneAdjustments, isEdited } from './lib/adjustments';
import { removeDustFromBlob } from './lib/retouch';
import { computeDHash } from './lib/similarity';
import { renderExportBlob } from './lib/exporter';
import { masterOf } from './lib/photo';

const THUMB_SIZE = 480;

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function makeThumbnail(bitmap) {
  const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('thumbnail'))), 'image/jpeg', 0.82);
  });
}

// Runtime wrapper: DB record + object URLs (not persisted).
function toRuntime(record) {
  return {
    ...record,
    thumbUrl: URL.createObjectURL(record.thumb),
    edited: isEdited(record.adjustments),
  };
}

const persistTimers = new Map();

export const useStore = create((set, get) => ({
  module: 'library', // 'dashboard' | 'library' | 'develop'
  photos: [],
  selectedId: null,
  loading: true,
  importing: false,
  importProgress: null, // { done, total, errors: [] }
  toasts: [],
  exportDialogOpen: false,

  toast(message, kind = 'info') {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4200);
  },

  async hydrate() {
    try {
      const records = await db.getAllPhotos();
      records.sort((a, b) => b.importedAt - a.importedAt);
      set({ photos: records.map(toRuntime), loading: false });
    } catch (err) {
      console.error('hydrate failed', err);
      set({ loading: false });
      get().toast('Impossible de charger la bibliothèque', 'error');
    }
  },

  setModule(module) {
    const { photos, selectedId } = get();
    if (module === 'develop' && !selectedId && photos.length > 0) {
      set({ selectedId: photos[0].id });
    }
    set({ module });
  },

  selectPhoto(id) {
    set({ selectedId: id });
  },

  openInDevelop(id) {
    set({ selectedId: id, module: 'develop' });
  },

  async importFiles(fileList) {
    const files = Array.from(fileList).filter(
      (f) => isRawFile(f) || f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name)
    );
    if (files.length === 0) {
      get().toast('Aucun fichier image ou RAW reconnu', 'error');
      return;
    }
    set({ importing: true, importProgress: { done: 0, total: files.length, errors: [] } });
    const errors = [];
    let firstNewId = null;

    for (const file of files) {
      try {
        const raw = isRawFile(file);
        const master = raw ? await extractRawPreview(file) : file;
        const bitmap = await createImageBitmap(master, { imageOrientation: 'from-image' });
        const thumb = await makeThumbnail(bitmap);
        const record = {
          id: uid(),
          name: file.name,
          format: fileExtension(file.name).toUpperCase() || 'IMG',
          isRaw: raw,
          width: bitmap.width,
          height: bitmap.height,
          size: file.size,
          importedAt: Date.now(),
          rating: 0,
          flag: null, // null | 'pick' | 'reject'
          adjustments: cloneAdjustments(DEFAULT_ADJUSTMENTS),
          original: file,
          master,
          thumb,
        };
        bitmap.close();
        await db.putPhoto(record);
        if (!firstNewId) firstNewId = record.id;
        set((s) => ({
          photos: [toRuntime(record), ...s.photos],
          importProgress: { ...s.importProgress, done: s.importProgress.done + 1 },
        }));
      } catch (err) {
        console.error('import failed for', file.name, err);
        errors.push(file.name);
        set((s) => ({
          importProgress: {
            ...s.importProgress,
            done: s.importProgress.done + 1,
            errors: [...s.importProgress.errors, file.name],
          },
        }));
      }
    }

    set({ importing: false, importProgress: null });
    const ok = files.length - errors.length;
    if (ok > 0) get().toast(`${ok} photo${ok > 1 ? 's' : ''} importée${ok > 1 ? 's' : ''}`, 'success');
    if (errors.length > 0) get().toast(`Échec import : ${errors.join(', ')}`, 'error');
    if (firstNewId && !get().selectedId) set({ selectedId: firstNewId });
  },

  updateAdjustments(id, adjustments) {
    set((s) => ({
      photos: s.photos.map((p) =>
        p.id === id ? { ...p, adjustments, edited: isEdited(adjustments) } : p
      ),
    }));
    // Debounced persistence (slider drags fire continuously).
    clearTimeout(persistTimers.get(id));
    persistTimers.set(
      id,
      setTimeout(() => {
        db.updatePhotoFields(id, { adjustments }).catch((err) =>
          console.error('persist adjustments failed', err)
        );
      }, 400)
    );
  },

  resetAdjustments(id) {
    get().updateAdjustments(id, cloneAdjustments(DEFAULT_ADJUSTMENTS));
  },

  async setRating(id, rating) {
    set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, rating } : p)) }));
    await db.updatePhotoFields(id, { rating });
  },

  async setFlag(id, flag) {
    set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, flag } : p)) }));
    await db.updatePhotoFields(id, { flag });
  },

  async deletePhoto(id) {
    const photo = get().photos.find((p) => p.id === id);
    if (photo?.thumbUrl) URL.revokeObjectURL(photo.thumbUrl);
    set((s) => {
      const photos = s.photos.filter((p) => p.id !== id);
      return {
        photos,
        selectedId: s.selectedId === id ? (photos[0]?.id ?? null) : s.selectedId,
      };
    });
    await db.deletePhotoById(id);
    get().toast('Photo supprimée', 'info');
  },

  setExportDialogOpen(open) {
    set({ exportDialogOpen: open });
  },

  // --- v2: Reels, dust removal, duplicates, faces ---
  reelOpen: false,
  duplicatesOpen: false,
  facesOpen: false,
  dustBusy: false,

  setReelOpen(open) { set({ reelOpen: open }); },
  setDuplicatesOpen(open) { set({ duplicatesOpen: open }); },
  setFacesOpen(open) { set({ facesOpen: open }); },

  // Generic persisted patch: updates runtime state + IndexedDB record.
  async patchPhoto(id, fields) {
    set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, ...fields } : p)) }));
    await db.updatePhotoFields(id, fields);
  },

  async removeDust(id) {
    const photo = get().photos.find((p) => p.id === id);
    if (!photo || get().dustBusy) return;
    set({ dustBusy: true });
    try {
      const result = await removeDustFromBlob(photo.master);
      if (!result.changed) {
        get().toast('Aucune imperfection détectée sur cette photo', 'info');
      } else {
        const bitmap = await createImageBitmap(result.blob);
        const thumb = await makeThumbnail(bitmap);
        bitmap.close();
        if (photo.thumbUrl) URL.revokeObjectURL(photo.thumbUrl);
        await get().patchPhoto(id, { retouched: result.blob, retouchCount: result.count, thumb });
        set((s) => ({
          photos: s.photos.map((p) => (p.id === id ? { ...p, thumbUrl: URL.createObjectURL(thumb) } : p)),
        }));
        get().toast(
          `${result.count} imperfection${result.count > 1 ? 's' : ''} supprimée${result.count > 1 ? 's' : ''} par l'IA`,
          'success'
        );
      }
    } catch (err) {
      console.error('dust removal failed', err);
      get().toast(`Échec de la retouche : ${err.message || err}`, 'error');
    } finally {
      set({ dustBusy: false });
    }
  },

  // Re-renders the library thumbnail through the full develop pipeline
  // (crop, curve, masks...). Called after operations that change geometry.
  async refreshThumb(id) {
    const photo = get().photos.find((p) => p.id === id);
    if (!photo) return;
    try {
      const { blob } = await renderExportBlob(masterOf(photo), photo.adjustments, {
        format: 'jpeg',
        quality: 0.82,
        maxDimension: 480,
      });
      if (photo.thumbUrl) URL.revokeObjectURL(photo.thumbUrl);
      await get().patchPhoto(id, { thumb: blob });
      set((s) => ({
        photos: s.photos.map((p) => (p.id === id ? { ...p, thumbUrl: URL.createObjectURL(blob) } : p)),
      }));
    } catch (err) {
      console.error('thumb refresh failed', err);
    }
  },

  async undoDust(id) {
    const photo = get().photos.find((p) => p.id === id);
    if (!photo) return;
    const bitmap = await createImageBitmap(photo.master, { imageOrientation: 'from-image' });
    const thumb = await makeThumbnail(bitmap);
    bitmap.close();
    if (photo.thumbUrl) URL.revokeObjectURL(photo.thumbUrl);
    await get().patchPhoto(id, { retouched: null, retouchCount: 0, thumb });
    set((s) => ({
      photos: s.photos.map((p) => (p.id === id ? { ...p, thumbUrl: URL.createObjectURL(thumb) } : p)),
    }));
    get().toast('Retouche IA annulée — original restauré', 'info');
  },

  // Computes (and caches) perceptual hashes for the whole catalog.
  async ensureHashes(onProgress) {
    const photos = get().photos;
    const entries = [];
    let done = 0;
    for (const p of photos) {
      let hash = p.phash;
      // length check invalidates hashes cached under an older format
      if (!hash || hash.length !== 40) {
        hash = await computeDHash(p.thumb);
        await get().patchPhoto(p.id, { phash: hash });
      }
      entries.push({ id: p.id, hash });
      done++;
      onProgress?.(done / photos.length);
    }
    return entries;
  },

  async stackGroups(groups) {
    const photos = get().photos;
    let stacked = 0;
    for (const ids of groups) {
      const members = ids.map((id) => photos.find((p) => p.id === id)).filter(Boolean);
      if (members.length < 2) continue;
      const leader = [...members].sort(
        (a, b) => (b.rating - a.rating) || (a.importedAt - b.importedAt)
      )[0];
      for (const m of members) {
        await get().patchPhoto(m.id, { stackId: leader.id });
        stacked++;
      }
    }
    get().toast(
      `${groups.length} pile${groups.length > 1 ? 's' : ''} créée${groups.length > 1 ? 's' : ''} (${stacked} photos)`,
      'success'
    );
  },

  async unstackAll() {
    for (const p of get().photos) {
      if (p.stackId) await get().patchPhoto(p.id, { stackId: null });
    }
    get().toast('Toutes les piles ont été défaites', 'info');
  },
}));

export function selectedPhoto(state) {
  return state.photos.find((p) => p.id === state.selectedId) || null;
}
