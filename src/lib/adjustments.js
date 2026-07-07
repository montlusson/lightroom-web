// Adjustment model shared by the develop UI, the WebGL engine and the exporter.
// All values are stored in UI units (mostly -100..100) and normalized in the engine.

export const HSL_BANDS = [
  { key: 'red', label: 'Rouge', hue: 0, color: '#e5484d' },
  { key: 'orange', label: 'Orange', hue: 30, color: '#f76b15' },
  { key: 'yellow', label: 'Jaune', hue: 60, color: '#ffe629' },
  { key: 'green', label: 'Vert', hue: 120, color: '#46a758' },
  { key: 'aqua', label: 'Turquoise', hue: 180, color: '#00b8d9' },
  { key: 'blue', label: 'Bleu', hue: 240, color: '#3b82f6' },
  { key: 'purple', label: 'Violet', hue: 280, color: '#8e4ec6' },
  { key: 'magenta', label: 'Magenta', hue: 320, color: '#d6409f' },
];

export const DEFAULT_CURVE_POINTS = [{ x: 0, y: 0 }, { x: 1, y: 1 }];

export const DEFAULT_ADJUSTMENTS = {
  exposure: 0,      // -5..+5 EV
  contrast: 0,      // -100..100
  highlights: 0,    // -100..100
  shadows: 0,       // -100..100
  whites: 0,        // -100..100
  blacks: 0,        // -100..100
  temperature: 0,   // -100..100
  tint: 0,          // -100..100
  vibrance: 0,      // -100..100
  saturation: 0,    // -100..100
  sharpness: 0,     // 0..100
  vignette: 0,      // -100..100
  grain: 0,         // 0..100
  rotation: 0,      // quarter turns 0..3
  crop: null,       // { x, y, w, h } normalized in rotated-image space, or null
  curve: { points: DEFAULT_CURVE_POINTS }, // tone curve control points (0..1)
  masks: [],        // local adjustment masks (max 3), see lib/masks.js
  hsl: HSL_BANDS.reduce((acc, band) => {
    acc[band.key] = { hue: 0, sat: 0, lum: 0 };
    return acc;
  }, {}),
};

// Deep clone + normalization: photos saved by older app versions may lack
// the newer fields (crop, curve, masks).
export function cloneAdjustments(adj = DEFAULT_ADJUSTMENTS) {
  const c = structuredClone(adj);
  return {
    ...structuredClone(DEFAULT_ADJUSTMENTS),
    ...c,
    crop: c.crop ?? null,
    curve: c.curve?.points?.length >= 2 ? c.curve : { points: structuredClone(DEFAULT_CURVE_POINTS) },
    masks: Array.isArray(c.masks) ? c.masks : [],
    hsl: Object.fromEntries(
      HSL_BANDS.map((b) => [b.key, { ...(c.hsl?.[b.key] || { hue: 0, sat: 0, lum: 0 }) }])
    ),
  };
}

export function isDefaultCurve(curve) {
  const p = curve?.points;
  if (!p || p.length !== 2) return !p || p.length < 2;
  return p[0].x === 0 && p[0].y === 0 && p[1].x === 1 && p[1].y === 1;
}

// Rotating the image by a quarter turn changes the rotated-image coordinate
// space: crop and mask geometry must follow so they stay anchored visually.
export function rotateAdjustmentsGeometry(adj) {
  const next = cloneAdjustments(adj);
  next.rotation = ((next.rotation ?? 0) + 1) % 4;
  if (next.crop) {
    const { x, y, w, h } = next.crop;
    next.crop = { x: 1 - y - h, y: x, w: h, h: w };
  }
  next.masks = next.masks.map((m) => {
    if (m.type === 'radial') {
      const p = m.params;
      return { ...m, params: { ...p, cx: 1 - p.cy, cy: p.cx, rx: p.ry, ry: p.rx } };
    }
    if (m.type === 'linear') {
      const p = m.params;
      return { ...m, params: { ...p, cx: 1 - p.cy, cy: p.cx, angle: ((p.angle ?? 90) + 90) % 360 } };
    }
    return m;
  });
  return next;
}

export function isEdited(adj) {
  if (!adj) return false;
  const d = DEFAULT_ADJUSTMENTS;
  for (const key of Object.keys(d)) {
    if (key === 'hsl' || key === 'crop' || key === 'curve' || key === 'masks') continue;
    if ((adj[key] ?? 0) !== d[key]) return true;
  }
  if (adj.crop) return true;
  if (!isDefaultCurve(adj.curve)) return true;
  if (adj.masks?.length > 0) return true;
  for (const band of HSL_BANDS) {
    const v = adj.hsl?.[band.key];
    if (v && (v.hue !== 0 || v.sat !== 0 || v.lum !== 0)) return true;
  }
  return false;
}

export const PRESETS = [
  {
    name: 'Éclat naturel',
    values: { exposure: 0.15, contrast: 12, highlights: -20, shadows: 18, vibrance: 22, sharpness: 20 },
  },
  {
    name: 'Noir & blanc contrasté',
    values: { saturation: -100, contrast: 35, highlights: -15, shadows: 10, blacks: -20, sharpness: 25, grain: 15 },
  },
  {
    name: 'Chrome froid',
    values: { temperature: -25, tint: 5, contrast: 18, vibrance: 10, highlights: -25 },
  },
  {
    name: 'Heure dorée',
    values: { temperature: 35, exposure: 0.2, highlights: -18, shadows: 22, vibrance: 18, vignette: -18 },
  },
  {
    name: 'Cinéma fané',
    values: { contrast: -15, blacks: 25, saturation: -20, temperature: 10, grain: 30, vignette: -25 },
  },
  {
    name: 'Punchy',
    values: { contrast: 30, whites: 15, blacks: -15, vibrance: 35, sharpness: 35 },
  },
];

export function applyPreset(preset) {
  const adj = cloneAdjustments(DEFAULT_ADJUSTMENTS);
  Object.assign(adj, preset.values);
  return adj;
}
