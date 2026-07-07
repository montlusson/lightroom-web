import React, { useMemo } from 'react';
import { useStore } from '../store';

function StatCard({ label, value, hint, accent }) {
  return (
    <div className="bg-lr-panel border border-lr-border rounded-xl p-5 min-w-0">
      <p className="text-[12px] text-lr-text-dim font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-semibold mt-2 ${accent ? 'text-lr-accent' : 'text-white'}`}>{value}</p>
      {hint && <p className="text-[12px] text-lr-text-dim mt-1">{hint}</p>}
    </div>
  );
}

export default function Dashboard() {
  const photos = useStore((s) => s.photos);
  const setModule = useStore((s) => s.setModule);
  const openInDevelop = useStore((s) => s.openInDevelop);

  const stats = useMemo(() => {
    const rawCount = photos.filter((p) => p.isRaw).length;
    const editedCount = photos.filter((p) => p.edited).length;
    const totalBytes = photos.reduce((acc, p) => acc + (p.size || 0), 0);
    const ratings = [0, 0, 0, 0, 0, 0];
    photos.forEach((p) => { ratings[p.rating || 0]++; });
    const formats = {};
    photos.forEach((p) => { formats[p.format] = (formats[p.format] || 0) + 1; });
    const topFormats = Object.entries(formats).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { rawCount, editedCount, totalBytes, ratings, topFormats };
  }, [photos]);

  const recent = photos.slice(0, 12);
  const maxRating = Math.max(1, ...stats.ratings);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-xl font-semibold text-white mb-1">Tableau de bord</h1>
        <p className="text-[13px] text-lr-text-dim mb-6">Vue d'ensemble de votre catalogue local.</p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Photos" value={photos.length} hint="dans la bibliothèque" accent />
          <StatCard label="Fichiers RAW" value={stats.rawCount} hint="aperçus extraits automatiquement" />
          <StatCard label="Retouchées" value={stats.editedCount} hint="avec réglages de développement" />
          <StatCard
            label="Stockage"
            value={stats.totalBytes > 1e9 ? `${(stats.totalBytes / 1e9).toFixed(2)} Go` : `${(stats.totalBytes / 1e6).toFixed(1)} Mo`}
            hint="originaux conservés localement"
          />
        </div>

        <div className="grid lg:grid-cols-2 gap-4 mb-6">
          {/* Ratings distribution */}
          <div className="bg-lr-panel border border-lr-border rounded-xl p-5">
            <h2 className="text-[13px] font-semibold text-white mb-4">Répartition des notes</h2>
            <div className="space-y-2.5">
              {[5, 4, 3, 2, 1, 0].map((r) => (
                <div key={r} className="flex items-center gap-3">
                  <span className="w-20 text-[12px] text-lr-text-dim shrink-0">
                    {r === 0 ? 'Sans note' : '★'.repeat(r)}
                  </span>
                  <div className="flex-1 h-4 bg-lr-canvas rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${r === 0 ? 'bg-[#3d3d3d]' : 'bg-amber-400/80'}`}
                      style={{ width: `${(stats.ratings[r] / maxRating) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-[12px] tabular-nums text-lr-text">{stats.ratings[r]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Formats */}
          <div className="bg-lr-panel border border-lr-border rounded-xl p-5">
            <h2 className="text-[13px] font-semibold text-white mb-4">Formats de fichiers</h2>
            {stats.topFormats.length === 0 ? (
              <p className="text-[12px] text-lr-text-dim">Aucune donnée — importez des photos.</p>
            ) : (
              <div className="space-y-2.5">
                {stats.topFormats.map(([fmt, count]) => (
                  <div key={fmt} className="flex items-center gap-3">
                    <span className="w-20 text-[12px] text-lr-text-dim shrink-0">{fmt}</span>
                    <div className="flex-1 h-4 bg-lr-canvas rounded overflow-hidden">
                      <div
                        className="h-full rounded bg-lr-accent/70"
                        style={{ width: `${(count / photos.length) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-[12px] tabular-nums text-lr-text">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent imports */}
        <div className="bg-lr-panel border border-lr-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-semibold text-white">Imports récents</h2>
            <button
              onClick={() => setModule('library')}
              className="text-[12px] text-lr-accent hover:underline cursor-pointer"
            >
              Voir la bibliothèque →
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="text-[12px] text-lr-text-dim">
              Bibliothèque vide. Glissez-déposez des photos ou utilisez le bouton Importer.
            </p>
          ) : (
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {recent.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openInDevelop(p.id)}
                  title={`Développer ${p.name}`}
                  className="shrink-0 w-28 h-20 rounded-lg overflow-hidden bg-lr-canvas border border-lr-border hover:border-lr-accent transition-colors cursor-pointer flex items-center justify-center"
                >
                  <img src={p.thumbUrl} alt={p.name} className="max-w-full max-h-full object-contain" draggable={false} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
