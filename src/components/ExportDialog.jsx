import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { EXPORT_FORMATS, renderExportBlob, downloadBlob, baseName } from '../lib/exporter';
import { masterOf } from '../lib/photo';

const SIZE_OPTIONS = [
  { value: 0, label: 'Taille d’origine' },
  { value: 4096, label: 'Longueur max 4096 px' },
  { value: 2048, label: 'Longueur max 2048 px' },
  { value: 1080, label: 'Longueur max 1080 px' },
];

export default function ExportDialog({ photo }) {
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);
  const toast = useStore((s) => s.toast);
  const [format, setFormat] = useState('jpeg');
  const [quality, setQuality] = useState(90);
  const [maxDimension, setMaxDimension] = useState(0);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef(null);

  const fmt = EXPORT_FORMATS.find((f) => f.id === format);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setExportDialogOpen(false);
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector('select, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [setExportDialogOpen]);

  async function doExport() {
    setBusy(true);
    try {
      const result = await renderExportBlob(masterOf(photo), photo.adjustments, {
        format,
        quality: quality / 100,
        maxDimension,
      });
      downloadBlob(result.blob, `${baseName(photo.name)}_lrweb.${result.ext}`);
      toast(`Exporté : ${result.width}×${result.height} ${fmt.label} (${(result.blob.size / 1e6).toFixed(2)} Mo)`, 'success');
      setExportDialogOpen(false);
    } catch (err) {
      console.error('export failed', err);
      toast(`Échec de l'export : ${err.message || err}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) setExportDialogOpen(false); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        className="w-[420px] max-w-[92vw] bg-lr-panel border border-lr-border rounded-xl shadow-2xl p-5"
      >
        <h2 id="export-title" className="text-[15px] font-semibold text-white mb-1">Exporter la photo</h2>
        <p className="text-[12px] text-lr-text-dim mb-4 truncate">
          {photo.name} — {photo.width}×{photo.height}{photo.edited ? ' — réglages appliqués' : ''}
        </p>

        <label htmlFor="exp-format" className="block text-[12px] text-lr-text-dim mb-1">Format</label>
        <select
          id="exp-format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="w-full h-9 px-2 mb-4 rounded-md bg-lr-canvas border border-lr-border text-[13px] cursor-pointer"
        >
          {EXPORT_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>

        {fmt?.hasQuality && (
          <div className="mb-4">
            <div className="flex justify-between text-[12px] mb-1">
              <label htmlFor="exp-quality" className="text-lr-text-dim">Qualité</label>
              <span className="tabular-nums text-white">{quality}</span>
            </div>
            <input
              id="exp-quality"
              type="range"
              min="40"
              max="100"
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="lr-slider"
            />
          </div>
        )}

        <label htmlFor="exp-size" className="block text-[12px] text-lr-text-dim mb-1">Dimensions</label>
        <select
          id="exp-size"
          value={maxDimension}
          onChange={(e) => setMaxDimension(Number(e.target.value))}
          className="w-full h-9 px-2 mb-6 rounded-md bg-lr-canvas border border-lr-border text-[13px] cursor-pointer"
        >
          {SIZE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <div className="flex justify-end gap-2">
          <button
            onClick={() => setExportDialogOpen(false)}
            className="h-9 px-4 rounded-md border border-lr-border bg-lr-panel-2 text-[13px] hover:bg-[#303030] cursor-pointer"
          >
            Annuler
          </button>
          <button
            onClick={doExport}
            disabled={busy}
            className="h-9 px-5 rounded-md bg-lr-accent hover:bg-[#4db4ff] text-black text-[13px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          >
            {busy ? 'Traitement…' : 'Exporter'}
          </button>
        </div>
      </div>
    </div>
  );
}
