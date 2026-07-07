import React from 'react';
import { MASK_TYPES, MAX_MASKS, createMask, maskLabel } from '../lib/masks';
import Slider from './Slider';

export default function MaskPanel({ masks = [], onChange, selectedId, onSelect }) {
  const selected = masks.find((m) => m.id === selectedId) || null;

  function update(next) {
    onChange(next);
  }

  function addMask(type) {
    if (masks.length >= MAX_MASKS) return;
    const mask = createMask(type);
    update([...masks.map((m) => structuredClone(m)), mask]);
    onSelect(mask.id);
  }

  function removeMask(id) {
    update(masks.filter((m) => m.id !== id).map((m) => structuredClone(m)));
    if (selectedId === id) onSelect(null);
  }

  function patchMask(id, patch) {
    update(masks.map((m) => (m.id === id ? { ...structuredClone(m), ...patch } : structuredClone(m))));
  }

  function patchParams(id, key, value) {
    const m = masks.find((x) => x.id === id);
    patchMask(id, { params: { ...m.params, [key]: value } });
  }

  function patchAdj(id, key, value) {
    const m = masks.find((x) => x.id === id);
    patchMask(id, { adjustments: { ...m.adjustments, [key]: value } });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {MASK_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => addMask(t.id)}
            disabled={masks.length >= MAX_MASKS}
            className="h-7 px-2.5 rounded-md border border-lr-border bg-lr-panel-2 hover:bg-[#303030] text-[11px] cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
            title={`Ajouter un masque ${t.label}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {masks.length >= MAX_MASKS && (
        <p className="text-[10px] text-lr-text-dim mb-2">Maximum {MAX_MASKS} masques par photo.</p>
      )}

      {masks.length === 0 ? (
        <p className="text-[11px] text-lr-text-dim">
          Aucun masque. « Sujet » et « Ciel » sont détectés automatiquement par l'IA ;
          Radial et Linéaire se positionnent avec les curseurs.
        </p>
      ) : (
        <ul className="space-y-1 mb-2">
          {masks.map((m, i) => (
            <li key={m.id} className="flex items-center gap-1.5">
              <button
                onClick={() => onSelect(selectedId === m.id ? null : m.id)}
                aria-pressed={selectedId === m.id}
                className={`flex-1 text-left px-2.5 py-1.5 rounded text-[12px] cursor-pointer transition-colors ${
                  selectedId === m.id
                    ? 'bg-lr-accent/15 text-white border border-lr-accent/60'
                    : 'text-lr-text-dim hover:text-white hover:bg-lr-panel-2 border border-transparent'
                }`}
              >
                {maskLabel(m, i)}
                {m.invert ? ' (inversé)' : ''}
              </button>
              <button
                onClick={() => removeMask(m.id)}
                aria-label={`Supprimer ${maskLabel(m, i)}`}
                className="w-6 h-6 rounded text-lr-text-dim hover:text-red-400 hover:bg-red-950/40 cursor-pointer text-[13px]"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="mt-2 pt-2 border-t border-lr-border">
          <label className="flex items-center gap-2 text-[11px] text-lr-text-dim mb-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!selected.invert}
              onChange={(e) => patchMask(selected.id, { invert: e.target.checked })}
              className="accent-[#31a8ff]"
            />
            Inverser le masque
          </label>

          {selected.type === 'radial' && (
            <>
              <p className="text-[10px] font-semibold text-lr-text-dim uppercase tracking-wide mb-1">Géométrie</p>
              <Slider label="Centre X" value={Math.round(selected.params.cx * 100)} min={0} max={100} defaultValue={50} onChange={(v) => patchParams(selected.id, 'cx', v / 100)} />
              <Slider label="Centre Y" value={Math.round(selected.params.cy * 100)} min={0} max={100} defaultValue={50} onChange={(v) => patchParams(selected.id, 'cy', v / 100)} />
              <Slider label="Largeur" value={Math.round(selected.params.rx * 100)} min={5} max={80} defaultValue={35} onChange={(v) => patchParams(selected.id, 'rx', v / 100)} />
              <Slider label="Hauteur" value={Math.round(selected.params.ry * 100)} min={5} max={80} defaultValue={30} onChange={(v) => patchParams(selected.id, 'ry', v / 100)} />
              <Slider label="Contour progressif" value={Math.round(selected.params.feather * 100)} min={0} max={100} defaultValue={50} onChange={(v) => patchParams(selected.id, 'feather', v / 100)} />
            </>
          )}
          {selected.type === 'linear' && (
            <>
              <p className="text-[10px] font-semibold text-lr-text-dim uppercase tracking-wide mb-1">Géométrie</p>
              <Slider label="Centre X" value={Math.round(selected.params.cx * 100)} min={0} max={100} defaultValue={50} onChange={(v) => patchParams(selected.id, 'cx', v / 100)} />
              <Slider label="Centre Y" value={Math.round(selected.params.cy * 100)} min={0} max={100} defaultValue={30} onChange={(v) => patchParams(selected.id, 'cy', v / 100)} />
              <Slider label="Rotation" value={selected.params.angle} min={0} max={360} defaultValue={90} onChange={(v) => patchParams(selected.id, 'angle', v)} />
              <Slider label="Étendue" value={Math.round(selected.params.range * 100)} min={5} max={100} defaultValue={50} onChange={(v) => patchParams(selected.id, 'range', v / 100)} />
            </>
          )}

          <p className="text-[10px] font-semibold text-lr-text-dim uppercase tracking-wide mb-1 mt-2">Réglages locaux</p>
          <Slider label="Exposition" value={selected.adjustments.exposure} min={-3} max={3} step={0.05} onChange={(v) => patchAdj(selected.id, 'exposure', v)} />
          <Slider label="Contraste" value={selected.adjustments.contrast} onChange={(v) => patchAdj(selected.id, 'contrast', v)} />
          <Slider label="Ombres" value={selected.adjustments.shadows} onChange={(v) => patchAdj(selected.id, 'shadows', v)} />
          <Slider label="Saturation" value={selected.adjustments.saturation} onChange={(v) => patchAdj(selected.id, 'saturation', v)} />
          <Slider label="Température" value={selected.adjustments.temperature} onChange={(v) => patchAdj(selected.id, 'temperature', v)} />
          <p className="text-[10px] text-lr-text-dim mt-1.5">
            Le masque sélectionné s'affiche en rouge sur l'image.
          </p>
        </div>
      )}
    </div>
  );
}
