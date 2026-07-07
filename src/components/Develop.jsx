import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useStore, selectedPhoto } from '../store';
import { ProcessingEngine, computeHistogram } from '../lib/engine';
import { buildCurveLUT } from '../lib/curve';
import {
  DEFAULT_ADJUSTMENTS, cloneAdjustments, rotateAdjustmentsGeometry,
  HSL_BANDS, PRESETS, applyPreset,
} from '../lib/adjustments';
import { masterOf } from '../lib/photo';
import { rasterizeMasks } from '../lib/masks';
import Slider from './Slider';
import Histogram from './Histogram';
import Filmstrip from './Filmstrip';
import Stars from './Stars';
import CurvePanel from './CurvePanel';
import MaskPanel from './MaskPanel';
import CropTool, { MaskOverlay, CROP_ASPECTS, fitAspect } from './CropTool';

const PREVIEW_MAX = 2048;
const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };

function Panel({ title, children, defaultOpen = true, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-lr-border">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2.5 text-[13px] font-semibold text-lr-text hover:bg-lr-panel-2/50 cursor-pointer"
      >
        <span>
          {title}
          {badge ? <span className="ml-2 text-[10px] text-lr-accent font-normal">{badge}</span> : null}
        </span>
        <span className={`text-lr-text-dim text-[10px] transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">▶</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

export default function Develop() {
  const photo = useStore(selectedPhoto);
  const updateAdjustments = useStore((s) => s.updateAdjustments);
  const resetAdjustments = useStore((s) => s.resetAdjustments);
  const setRating = useStore((s) => s.setRating);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);
  const setModule = useStore((s) => s.setModule);
  const removeDust = useStore((s) => s.removeDust);
  const undoDust = useStore((s) => s.undoDust);
  const dustBusy = useStore((s) => s.dustBusy);
  const refreshThumb = useStore((s) => s.refreshThumb);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const sourceRef = useRef(null);   // T-space preview canvas (for AI masks)
  const aiCacheRef = useRef(new Map());
  const rafRef = useRef(0);
  const histTimer = useRef(0);
  const [histogram, setHistogram] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [engineError, setEngineError] = useState(null);
  const [imageReady, setImageReady] = useState(false);
  const [hslBand, setHslBand] = useState('red');

  // Crop tool state
  const [cropMode, setCropMode] = useState(false);
  const [cropDraft, setCropDraft] = useState(null);
  const [cropAspectId, setCropAspectId] = useState('free');

  // Masking state
  const [selectedMaskId, setSelectedMaskId] = useState(null);
  const [maskCanvases, setMaskCanvases] = useState([]);

  const adj = photo?.adjustments || DEFAULT_ADJUSTMENTS;
  const rotation = ((adj.rotation ?? 0) % 4 + 4) % 4;
  const swap = rotation % 2 === 1;
  const rotW = photo ? (swap ? photo.height : photo.width) : 1;
  const rotH = photo ? (swap ? photo.width : photo.height) : 1;

  // Normalized-space aspect factor (w per h) for the selected preset.
  const aspectK = useMemo(() => {
    const preset = CROP_ASPECTS.find((a) => a.id === cropAspectId);
    if (!preset || preset.ratio === null) return null;
    const pixelRatio = preset.ratio === 'original' ? rotW / rotH : preset.ratio;
    return (pixelRatio * rotH) / rotW;
  }, [cropAspectId, rotW, rotH]);

  // --- Load master image into the engine when the photo changes ---
  useEffect(() => {
    if (!photo || !canvasRef.current) return;
    let cancelled = false;
    setImageReady(false);
    setCropMode(false);
    setSelectedMaskId(null);
    aiCacheRef.current = new Map();
    (async () => {
      try {
        if (!engineRef.current) {
          engineRef.current = new ProcessingEngine(canvasRef.current);
          if (window.__lrTest) window.__lrTest.engine = engineRef.current;
        }
        const bitmap = await createImageBitmap(masterOf(photo), { imageOrientation: 'from-image' });
        const scale = Math.min(1, PREVIEW_MAX / Math.max(bitmap.width, bitmap.height));
        const tmp = document.createElement('canvas');
        tmp.width = Math.max(1, Math.round(bitmap.width * scale));
        tmp.height = Math.max(1, Math.round(bitmap.height * scale));
        tmp.getContext('2d').drawImage(bitmap, 0, 0, tmp.width, tmp.height);
        bitmap.close();
        if (cancelled) return;
        sourceRef.current = tmp;
        engineRef.current.setImage(tmp);
        setImageReady(true);
      } catch (err) {
        console.error('develop load failed', err);
        setEngineError(String(err.message || err));
      }
    })();
    return () => { cancelled = true; };
  }, [photo?.id, photo?.master, photo?.retouched]);

  // --- Rasterize masks when their geometry (not their sliders) changes ---
  const maskGeomKey = useMemo(
    () => JSON.stringify((adj.masks || []).map((m) => [m.id, m.type, m.params])) + `|r${rotation}`,
    [adj.masks, rotation]
  );
  useEffect(() => {
    if (!imageReady || !engineRef.current || !sourceRef.current) return;
    const masks = (adj.masks || []).slice(0, 3);
    const canvases = masks.length > 0
      ? rasterizeMasks(masks, sourceRef.current, rotation, aiCacheRef.current)
      : [];
    engineRef.current.setMasks(canvases);
    setMaskCanvases(canvases);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskGeomKey, imageReady]);

  // --- Re-render on every adjustment change (rAF-coalesced) ---
  const renderNow = useCallback(() => {
    if (!engineRef.current || !imageReady) return;
    const effective = showOriginal
      ? { ...cloneAdjustments(DEFAULT_ADJUSTMENTS), rotation: adj.rotation, crop: adj.crop }
      : adj;
    engineRef.current.setCurve(buildCurveLUT(showOriginal ? null : adj.curve));
    engineRef.current.render(effective, { ignoreCrop: cropMode });
    clearTimeout(histTimer.current);
    histTimer.current = setTimeout(() => {
      try {
        setHistogram(computeHistogram(canvasRef.current));
      } catch { /* histogram is cosmetic */ }
    }, 120);
  }, [adj, showOriginal, imageReady, cropMode, maskCanvases]);

  useEffect(() => {
    // rAF coalesces slider drags; the timeout fallback guarantees the render
    // also happens when the tab is hidden (rAF never fires there).
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      renderNow();
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(run);
    const fallback = setTimeout(run, 80);
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(fallback);
    };
  }, [renderNow]);

  useEffect(() => () => {
    engineRef.current?.destroy();
    engineRef.current = null;
  }, []);

  const set = useCallback(
    (key, value) => {
      if (!photo) return;
      updateAdjustments(photo.id, { ...cloneAdjustments(photo.adjustments), [key]: value });
    },
    [photo, updateAdjustments]
  );

  const setHsl = useCallback(
    (band, channel, value) => {
      if (!photo) return;
      const next = cloneAdjustments(photo.adjustments);
      next.hsl[band][channel] = value;
      updateAdjustments(photo.id, next);
    },
    [photo, updateAdjustments]
  );

  // --- Crop tool actions ---
  function enterCropMode() {
    setCropDraft(adj.crop ? { ...adj.crop } : { ...FULL_CROP });
    setCropAspectId('free');
    setSelectedMaskId(null);
    setCropMode(true);
  }

  function applyCrop() {
    if (!photo || !cropDraft) return;
    const isFull =
      cropDraft.x < 0.005 && cropDraft.y < 0.005 && cropDraft.w > 0.995 && cropDraft.h > 0.995;
    set('crop', isFull ? null : { ...cropDraft });
    setCropMode(false);
    refreshThumb(photo.id);
  }

  function selectAspect(id) {
    setCropAspectId(id);
    const preset = CROP_ASPECTS.find((a) => a.id === id);
    if (preset && preset.ratio !== null && cropDraft) {
      const pixelRatio = preset.ratio === 'original' ? rotW / rotH : preset.ratio;
      setCropDraft(fitAspect(cropDraft, (pixelRatio * rotH) / rotW));
    }
  }

  if (!photo) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-lg text-lr-text">Aucune photo sélectionnée</p>
          <button
            onClick={() => setModule('library')}
            className="h-9 px-4 rounded-md bg-lr-accent text-black text-[13px] font-semibold cursor-pointer"
          >
            Ouvrir la bibliothèque
          </button>
        </div>
        <Filmstrip />
      </div>
    );
  }

  const band = HSL_BANDS.find((b) => b.key === hslBand);
  const bandValues = adj.hsl?.[hslBand] || { hue: 0, sat: 0, lum: 0 };
  const selectedMaskIndex = (adj.masks || []).findIndex((m) => m.id === selectedMaskId);
  const selectedMaskCanvas = selectedMaskIndex >= 0 ? maskCanvases[selectedMaskIndex] : null;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex">
        {/* Left panel: presets */}
        <aside className="w-56 shrink-0 bg-lr-panel border-r border-lr-border overflow-y-auto hidden lg:block">
          <Panel title="Paramètres prédéfinis">
            <ul className="space-y-1">
              {PRESETS.map((preset) => (
                <li key={preset.name}>
                  <button
                    onClick={() => updateAdjustments(photo.id, applyPreset(preset))}
                    className="w-full text-left px-2.5 py-1.5 rounded text-[12px] text-lr-text-dim hover:text-white hover:bg-lr-panel-2 cursor-pointer transition-colors"
                  >
                    {preset.name}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Informations">
            <dl className="text-[11px] space-y-1.5 text-lr-text-dim">
              <div><dt className="inline font-medium text-lr-text">Fichier : </dt><dd className="inline break-all">{photo.name}</dd></div>
              <div><dt className="inline font-medium text-lr-text">Dimensions : </dt><dd className="inline">{photo.width} × {photo.height}</dd></div>
              <div><dt className="inline font-medium text-lr-text">Format : </dt><dd className="inline">{photo.format}{photo.isRaw ? ' (RAW)' : ''}</dd></div>
              <div><dt className="inline font-medium text-lr-text">Importée : </dt><dd className="inline">{new Date(photo.importedAt).toLocaleString('fr-FR')}</dd></div>
              {adj.crop && (
                <div><dt className="inline font-medium text-lr-text">Recadrage : </dt>
                  <dd className="inline">{Math.round(adj.crop.w * rotW)} × {Math.round(adj.crop.h * rotH)}</dd></div>
              )}
            </dl>
          </Panel>
        </aside>

        {/* Center: canvas */}
        <div className="flex-1 min-w-0 flex flex-col bg-lr-canvas">
          <div ref={containerRef} className="flex-1 min-h-0 flex items-center justify-center p-4 relative">
            {engineError ? (
              <p className="text-red-400 text-sm max-w-md text-center">{engineError}</p>
            ) : (
              <canvas
                ref={canvasRef}
                className="max-w-full max-h-full object-contain rounded-sm shadow-2xl"
                style={{ width: 'auto', height: 'auto' }}
                aria-label={`Aperçu de ${photo.name}`}
              />
            )}
            {showOriginal && (
              <span className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/70 text-[11px] font-semibold text-white z-10">
                AVANT
              </span>
            )}
            {cropMode && cropDraft && (
              <CropTool
                canvasRef={canvasRef}
                containerRef={containerRef}
                draft={cropDraft}
                setDraft={setCropDraft}
                aspectK={aspectK}
              />
            )}
            {!cropMode && selectedMaskCanvas && (
              <MaskOverlay
                canvasRef={canvasRef}
                containerRef={containerRef}
                maskCanvas={selectedMaskCanvas}
                crop={adj.crop}
              />
            )}
          </div>

          {/* Toolbar under canvas */}
          <div className="h-11 shrink-0 border-t border-lr-border bg-lr-panel flex items-center gap-2 px-3 overflow-x-auto">
            {cropMode ? (
              <>
                <span className="text-[12px] font-semibold text-white shrink-0">Recadrage</span>
                <label className="sr-only" htmlFor="crop-aspect">Format</label>
                <select
                  id="crop-aspect"
                  value={cropAspectId}
                  onChange={(e) => selectAspect(e.target.value)}
                  className="h-8 px-2 rounded-md bg-lr-canvas border border-lr-border text-[12px] cursor-pointer shrink-0"
                >
                  {CROP_ASPECTS.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => setCropDraft({ ...FULL_CROP })}
                  className="h-8 px-3 rounded-md border border-lr-border bg-lr-panel-2 text-[12px] hover:bg-[#303030] cursor-pointer shrink-0"
                >
                  Zone entière
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setCropMode(false)}
                  className="h-8 px-3 rounded-md border border-lr-border bg-lr-panel-2 text-[12px] hover:bg-[#303030] cursor-pointer shrink-0"
                >
                  Annuler
                </button>
                {adj.crop && (
                  <button
                    onClick={() => { set('crop', null); setCropMode(false); refreshThumb(photo.id); }}
                    className="h-8 px-3 rounded-md border border-red-900/60 text-red-400 hover:bg-red-950/40 text-[12px] cursor-pointer shrink-0"
                  >
                    Effacer le recadrage
                  </button>
                )}
                <button
                  onClick={applyCrop}
                  className="h-8 px-4 rounded-md bg-lr-accent hover:bg-[#4db4ff] text-black text-[12px] font-semibold cursor-pointer shrink-0"
                >
                  Appliquer
                </button>
              </>
            ) : (
              <>
                <Stars rating={photo.rating} onChange={(r) => setRating(photo.id, r)} />
                <div className="w-px h-5 bg-lr-border mx-1" />
                <button
                  onPointerDown={() => setShowOriginal(true)}
                  onPointerUp={() => setShowOriginal(false)}
                  onPointerLeave={() => setShowOriginal(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowOriginal(true); } }}
                  onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowOriginal(false); }}
                  className="h-8 px-3 rounded-md border border-lr-border bg-lr-panel-2 text-[12px] hover:bg-[#303030] cursor-pointer"
                  title="Maintenir pour voir l'original"
                >
                  Avant / Après
                </button>
                <button
                  onClick={enterCropMode}
                  className={`h-8 px-3 rounded-md border text-[12px] cursor-pointer ${
                    adj.crop
                      ? 'border-lr-accent/60 text-lr-accent bg-lr-accent/10'
                      : 'border-lr-border bg-lr-panel-2 hover:bg-[#303030]'
                  }`}
                  title="Recadrer l'image (manuel ou formats prédéfinis)"
                >
                  ⬚ Recadrer
                </button>
                <button
                  onClick={() => updateAdjustments(photo.id, rotateAdjustmentsGeometry(photo.adjustments))}
                  className="h-8 px-3 rounded-md border border-lr-border bg-lr-panel-2 text-[12px] hover:bg-[#303030] cursor-pointer"
                  title="Rotation 90° horaire"
                >
                  ⟳ Pivoter
                </button>
                <button
                  onClick={() => { resetAdjustments(photo.id); setSelectedMaskId(null); refreshThumb(photo.id); }}
                  className="h-8 px-3 rounded-md border border-lr-border bg-lr-panel-2 text-[12px] hover:bg-[#303030] cursor-pointer"
                >
                  Réinitialiser
                </button>
                <div className="w-px h-5 bg-lr-border mx-1" />
                {photo.retouched ? (
                  <button
                    onClick={() => undoDust(photo.id)}
                    className="h-8 px-3 rounded-md border border-violet-700/60 text-violet-300 hover:bg-violet-950/40 text-[12px] cursor-pointer"
                    title={`${photo.retouchCount || 0} imperfections corrigées — cliquer pour restaurer l'original`}
                  >
                    ✨ {photo.retouchCount || 0} corrigées — Annuler
                  </button>
                ) : (
                  <button
                    onClick={() => removeDust(photo.id)}
                    disabled={dustBusy}
                    className="h-8 px-3 rounded-md border border-violet-700/60 text-violet-300 hover:bg-violet-950/40 text-[12px] cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                    title="Supprimer automatiquement poussières et taches sur toute l'image"
                  >
                    {dustBusy ? 'Analyse…' : '✨ Poussières (IA)'}
                  </button>
                )}
                <div className="flex-1" />
                <button
                  onClick={() => setExportDialogOpen(true)}
                  className="h-8 px-4 rounded-md bg-lr-accent hover:bg-[#4db4ff] text-black text-[12px] font-semibold cursor-pointer"
                >
                  Exporter…
                </button>
              </>
            )}
          </div>
        </div>

        {/* Right panel: adjustments */}
        <aside className="w-[300px] shrink-0 bg-lr-panel border-l border-lr-border overflow-y-auto">
          <div className="p-3 border-b border-lr-border">
            <Histogram data={histogram} />
          </div>

          <Panel title="Réglages de base">
            <p className="text-[11px] font-semibold text-lr-text-dim uppercase tracking-wide mb-1.5 mt-1">Balance des blancs</p>
            <Slider label="Température" value={adj.temperature} onChange={(v) => set('temperature', v)} />
            <Slider label="Teinte" value={adj.tint} onChange={(v) => set('tint', v)} />
            <p className="text-[11px] font-semibold text-lr-text-dim uppercase tracking-wide mb-1.5 mt-3">Tonalité</p>
            <Slider label="Exposition" value={adj.exposure} min={-5} max={5} step={0.05} onChange={(v) => set('exposure', v)} />
            <Slider label="Contraste" value={adj.contrast} onChange={(v) => set('contrast', v)} />
            <Slider label="Hautes lumières" value={adj.highlights} onChange={(v) => set('highlights', v)} />
            <Slider label="Ombres" value={adj.shadows} onChange={(v) => set('shadows', v)} />
            <Slider label="Blancs" value={adj.whites} onChange={(v) => set('whites', v)} />
            <Slider label="Noirs" value={adj.blacks} onChange={(v) => set('blacks', v)} />
            <p className="text-[11px] font-semibold text-lr-text-dim uppercase tracking-wide mb-1.5 mt-3">Présence</p>
            <Slider label="Vibrance" value={adj.vibrance} onChange={(v) => set('vibrance', v)} />
            <Slider label="Saturation" value={adj.saturation} onChange={(v) => set('saturation', v)} />
          </Panel>

          <Panel title="Courbe de tonalité" defaultOpen={false}>
            <CurvePanel curve={adj.curve} onChange={(c) => set('curve', c)} histogram={histogram} />
          </Panel>

          <Panel title="Couleur (TSL)" defaultOpen={false}>
            <div className="flex gap-1 mb-3 flex-wrap" role="tablist" aria-label="Canal de couleur">
              {HSL_BANDS.map((b) => (
                <button
                  key={b.key}
                  role="tab"
                  aria-selected={hslBand === b.key}
                  aria-label={b.label}
                  title={b.label}
                  onClick={() => setHslBand(b.key)}
                  className={`w-7 h-7 rounded-full border-2 cursor-pointer transition-transform ${
                    hslBand === b.key ? 'border-white scale-110' : 'border-transparent hover:scale-105'
                  }`}
                  style={{ background: b.color }}
                />
              ))}
            </div>
            <p className="text-[12px] text-lr-text mb-2 font-medium">{band?.label}</p>
            <Slider label="Teinte" value={bandValues.hue} onChange={(v) => setHsl(hslBand, 'hue', v)} />
            <Slider label="Saturation" value={bandValues.sat} onChange={(v) => setHsl(hslBand, 'sat', v)} />
            <Slider label="Luminance" value={bandValues.lum} onChange={(v) => setHsl(hslBand, 'lum', v)} />
          </Panel>

          <Panel title="Masquage" defaultOpen={false} badge={adj.masks?.length ? `${adj.masks.length}` : null}>
            <MaskPanel
              masks={adj.masks || []}
              onChange={(masks) => set('masks', masks)}
              selectedId={selectedMaskId}
              onSelect={setSelectedMaskId}
            />
          </Panel>

          <Panel title="Détail" defaultOpen={false}>
            <Slider label="Netteté" value={adj.sharpness} min={0} max={100} onChange={(v) => set('sharpness', v)} />
          </Panel>

          <Panel title="Effets" defaultOpen={false}>
            <Slider label="Vignettage" value={adj.vignette} onChange={(v) => set('vignette', v)} />
            <Slider label="Grain" value={adj.grain} min={0} max={100} onChange={(v) => set('grain', v)} />
          </Panel>
        </aside>
      </div>

      <Filmstrip />
    </div>
  );
}
