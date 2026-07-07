import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { REEL_FORMATS, renderReel, pickVideoCodec } from '../lib/video';
import { downloadBlob } from '../lib/exporter';

const DURATIONS = [1.5, 2, 2.5, 3, 4];

export default function ReelDialog() {
  const photos = useStore((s) => s.photos);
  const setReelOpen = useStore((s) => s.setReelOpen);
  const toast = useStore((s) => s.toast);

  const [checked, setChecked] = useState(() => new Set(photos.slice(0, 10).map((p) => p.id)));
  const [format, setFormat] = useState('reel');
  const [seconds, setSeconds] = useState(2.5);
  const [kenBurns, setKenBurns] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const previewRef = useRef(null);
  const codec = pickVideoCodec();

  const selected = photos.filter((p) => checked.has(p.id));
  const fmt = REEL_FORMATS.find((f) => f.id === format);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !rendering) setReelOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setReelOpen, rendering]);

  function toggle(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createReel() {
    if (selected.length === 0) return;
    setRendering(true);
    setProgress(0);
    try {
      const result = await renderReel(
        selected,
        { width: fmt.width, height: fmt.height, secondsPerPhoto: seconds, kenBurns },
        { onProgress: setProgress, previewCanvas: previewRef.current }
      );
      downloadBlob(result.blob, `reel_${new Date().toISOString().slice(0, 10)}.${result.ext}`);
      const size = result.blob.size > 1e6
        ? `${(result.blob.size / 1e6).toFixed(1)} Mo`
        : `${Math.max(1, Math.round(result.blob.size / 1e3))} Ko`;
      toast(`Reel créé : ${Math.round(result.duration)} s, ${size} (${result.ext.toUpperCase()})`, 'success');
      setReelOpen(false);
    } catch (err) {
      console.error('reel failed', err);
      toast(`Échec de la création du Reel : ${err.message || err}`, 'error');
    } finally {
      setRendering(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center fade-in"
      onClick={(e) => { if (e.target === e.currentTarget && !rendering) setReelOpen(false); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reel-title"
        className="w-[680px] max-w-[94vw] max-h-[88vh] overflow-y-auto bg-lr-panel border border-lr-border rounded-xl shadow-2xl p-5"
      >
        <h2 id="reel-title" className="text-[15px] font-semibold text-white mb-1">Créer un Reel</h2>
        <p className="text-[12px] text-lr-text-dim mb-4">
          Vidéo à partir de vos photos développées — effet Ken Burns et fondus enchaînés.
        </p>

        {!codec && (
          <p className="text-[13px] text-red-400 mb-4">
            Ce navigateur ne prend pas en charge l'enregistrement vidéo (MediaRecorder).
          </p>
        )}

        <div className="flex gap-4 mb-4 flex-wrap">
          <div>
            <label htmlFor="reel-format" className="block text-[12px] text-lr-text-dim mb-1">Format</label>
            <select
              id="reel-format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              disabled={rendering}
              className="h-9 px-2 rounded-md bg-lr-canvas border border-lr-border text-[13px] cursor-pointer"
            >
              {REEL_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="reel-duration" className="block text-[12px] text-lr-text-dim mb-1">Durée par photo</label>
            <select
              id="reel-duration"
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              disabled={rendering}
              className="h-9 px-2 rounded-md bg-lr-canvas border border-lr-border text-[13px] cursor-pointer"
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>{d} s</option>
              ))}
            </select>
          </div>
          <label className="flex items-end gap-2 pb-2 text-[13px] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={kenBurns}
              onChange={(e) => setKenBurns(e.target.checked)}
              disabled={rendering}
              className="accent-[#31a8ff] w-4 h-4"
            />
            Effet Ken Burns (zoom/panoramique)
          </label>
        </div>

        <p className="text-[12px] text-lr-text-dim mb-2">
          Photos ({selected.length} sélectionnée{selected.length > 1 ? 's' : ''} — durée totale ≈ {Math.round(selected.length * seconds)} s)
        </p>
        <div className="flex flex-wrap gap-2 mb-4 max-h-44 overflow-y-auto p-1 bg-lr-canvas rounded-md border border-lr-border">
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              disabled={rendering}
              aria-pressed={checked.has(p.id)}
              title={p.name}
              className={`relative w-20 h-14 rounded overflow-hidden border-2 cursor-pointer bg-black flex items-center justify-center ${
                checked.has(p.id) ? 'border-lr-accent' : 'border-transparent opacity-45 hover:opacity-80'
              }`}
            >
              <img src={p.thumbUrl} alt={p.name} className="max-w-full max-h-full object-contain" draggable={false} />
              {checked.has(p.id) && (
                <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-lr-accent text-black text-[10px] font-bold flex items-center justify-center">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>

        {rendering && (
          <div className="mb-4">
            <div className="flex justify-center mb-3">
              <canvas
                ref={previewRef}
                className="rounded-md border border-lr-border bg-black"
                style={{ maxHeight: 220, maxWidth: '100%', width: 'auto' }}
                aria-label="Aperçu du rendu vidéo en cours"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-lr-border rounded-full overflow-hidden">
                <div className="h-full bg-lr-accent rounded-full transition-all" style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="text-[12px] tabular-nums text-lr-text-dim">{Math.round(progress * 100)} %</span>
            </div>
            <p className="text-[11px] text-lr-text-dim mt-2 text-center" role="status">
              Rendu en temps réel — gardez cet onglet visible.
            </p>
          </div>
        )}
        {!rendering && <canvas ref={previewRef} className="hidden" />}

        <div className="flex justify-end gap-2">
          <button
            onClick={() => setReelOpen(false)}
            disabled={rendering}
            className="h-9 px-4 rounded-md border border-lr-border bg-lr-panel-2 text-[13px] hover:bg-[#303030] cursor-pointer disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            onClick={createReel}
            disabled={rendering || selected.length === 0 || !codec}
            className="h-9 px-5 rounded-md bg-lr-accent hover:bg-[#4db4ff] text-black text-[13px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {rendering ? 'Rendu en cours…' : 'Créer la vidéo'}
          </button>
        </div>
      </div>
    </div>
  );
}
