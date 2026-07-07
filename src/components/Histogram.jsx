import React, { useMemo } from 'react';

// Renders RGB histograms as stacked translucent SVG paths, Lightroom-style.
function pathFor(bins, width, height) {
  const max = Math.max(1, ...bins);
  const n = bins.length;
  let d = `M0,${height}`;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * width;
    const y = height - Math.pow(bins[i] / max, 0.5) * height;
    d += `L${x.toFixed(1)},${y.toFixed(1)}`;
  }
  d += `L${width},${height}Z`;
  return d;
}

export default function Histogram({ data }) {
  const W = 260;
  const H = 96;
  const paths = useMemo(() => {
    if (!data) return null;
    return {
      r: pathFor(Array.from(data.r), W, H),
      g: pathFor(Array.from(data.g), W, H),
      b: pathFor(Array.from(data.b), W, H),
    };
  }, [data]);

  return (
    <div className="bg-lr-canvas rounded-md border border-lr-border overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full block"
        role="img"
        aria-label="Histogramme RVB de la photo affichée"
      >
        <title>Histogramme</title>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={W * f} y1="0" x2={W * f} y2={H} stroke="#2a2a2a" strokeWidth="1" />
        ))}
        {paths && (
          <>
            <path d={paths.r} fill="#e5484d" fillOpacity="0.45" style={{ mixBlendMode: 'screen' }} />
            <path d={paths.g} fill="#46a758" fillOpacity="0.45" style={{ mixBlendMode: 'screen' }} />
            <path d={paths.b} fill="#3b82f6" fillOpacity="0.45" style={{ mixBlendMode: 'screen' }} />
          </>
        )}
      </svg>
    </div>
  );
}
