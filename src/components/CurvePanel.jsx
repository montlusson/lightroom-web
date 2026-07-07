import React, { useMemo, useRef } from 'react';
import { monotoneCubic } from '../lib/curve';
import { isDefaultCurve, DEFAULT_CURVE_POINTS } from '../lib/adjustments';

const SIZE = 100; // SVG user units
const MAX_POINTS = 8;

export default function CurvePanel({ curve, onChange, histogram }) {
  const svgRef = useRef(null);
  const dragIndex = useRef(-1);
  const points = curve?.points?.length >= 2 ? curve.points : DEFAULT_CURVE_POINTS;

  const path = useMemo(() => {
    const f = monotoneCubic(points);
    let d = '';
    for (let i = 0; i <= 50; i++) {
      const x = i / 50;
      const y = Math.max(0, Math.min(1, f(x)));
      d += `${i === 0 ? 'M' : 'L'}${(x * SIZE).toFixed(1)},${((1 - y) * SIZE).toFixed(1)}`;
    }
    return d;
  }, [points]);

  const histPath = useMemo(() => {
    if (!histogram?.l) return null;
    const bins = Array.from(histogram.l);
    const max = Math.max(1, ...bins);
    let d = `M0,${SIZE}`;
    for (let i = 0; i < 256; i++) {
      d += `L${((i / 255) * SIZE).toFixed(1)},${(SIZE - Math.sqrt(bins[i] / max) * SIZE).toFixed(1)}`;
    }
    return d + `L${SIZE},${SIZE}Z`;
  }, [histogram]);

  function svgCoords(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
    };
  }

  function setPoints(next) {
    onChange({ points: next.sort((a, b) => a.x - b.x) });
  }

  function onPointerDown(e) {
    const { x, y } = svgCoords(e);
    // Grab the nearest point if close enough, otherwise add one.
    let best = -1;
    let bestDist = 0.08;
    points.forEach((p, i) => {
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < bestDist) { best = i; bestDist = dist; }
    });
    if (best === -1 && points.length < MAX_POINTS) {
      const next = [...points.map((p) => ({ ...p })), { x, y }].sort((a, b) => a.x - b.x);
      best = next.findIndex((p) => p.x === x && p.y === y);
      onChange({ points: next });
      dragIndex.current = best;
    } else {
      dragIndex.current = best;
    }
    if (dragIndex.current >= 0) {
      try { svgRef.current.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    }
  }

  function onPointerMove(e) {
    const i = dragIndex.current;
    if (i < 0) return;
    const { x, y } = svgCoords(e);
    const next = points.map((p) => ({ ...p }));
    const isFirst = i === 0;
    const isLast = i === next.length - 1;
    const minX = isFirst ? 0 : next[i - 1].x + 0.02;
    const maxX = isLast ? 1 : next[i + 1].x - 0.02;
    next[i] = {
      x: isFirst ? 0 : isLast ? 1 : Math.max(minX, Math.min(maxX, x)),
      y,
    };
    onChange({ points: next });
  }

  function onPointerUp(e) {
    dragIndex.current = -1;
    try { svgRef.current.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }

  function onDoubleClick(e) {
    const { x, y } = svgCoords(e);
    let best = -1;
    let bestDist = 0.08;
    points.forEach((p, i) => {
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < bestDist) { best = i; bestDist = dist; }
    });
    if (best > 0 && best < points.length - 1) {
      setPoints(points.filter((_, i) => i !== best).map((p) => ({ ...p })));
    }
  }

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full aspect-square bg-lr-canvas rounded-md border border-lr-border touch-none cursor-crosshair select-none"
        role="img"
        aria-label="Courbe de tonalité — cliquer pour ajouter un point, glisser pour ajuster, double-clic pour supprimer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {histPath && <path d={histPath} fill="#4a4a4a" fillOpacity="0.35" />}
        {[0.25, 0.5, 0.75].map((f) => (
          <React.Fragment key={f}>
            <line x1={f * SIZE} y1="0" x2={f * SIZE} y2={SIZE} stroke="#2c2c2c" strokeWidth="0.6" />
            <line x1="0" y1={f * SIZE} x2={SIZE} y2={f * SIZE} stroke="#2c2c2c" strokeWidth="0.6" />
          </React.Fragment>
        ))}
        <line x1="0" y1={SIZE} x2={SIZE} y2="0" stroke="#3a3a3a" strokeWidth="0.8" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke="#e6e6e6" strokeWidth="1.6" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x * SIZE}
            cy={(1 - p.y) * SIZE}
            r="3"
            fill={i === 0 || i === points.length - 1 ? '#9a9a9a' : '#31a8ff'}
            stroke="#111"
            strokeWidth="0.8"
          />
        ))}
      </svg>
      <div className="flex items-center justify-between mt-2">
        <p className="text-[10px] text-lr-text-dim">
          Clic : ajouter · glisser : ajuster · double-clic : retirer
        </p>
        <button
          onClick={() => onChange({ points: structuredClone(DEFAULT_CURVE_POINTS) })}
          disabled={isDefaultCurve(curve)}
          className="text-[11px] text-lr-text-dim hover:text-white cursor-pointer disabled:opacity-30"
        >
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
