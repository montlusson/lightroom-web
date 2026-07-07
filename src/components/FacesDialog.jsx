import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { analyzeFaces } from '../lib/faces';
import { masterOf } from '../lib/photo';

function ScoreBar({ label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-[11px] text-lr-text-dim shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-lr-canvas rounded overflow-hidden">
        <div
          className={`h-full rounded ${value >= 60 ? 'bg-emerald-500/80' : value >= 30 ? 'bg-amber-400/80' : 'bg-red-500/70'}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right text-[11px] tabular-nums">{value}</span>
    </div>
  );
}

export default function FacesDialog() {
  const photos = useStore((s) => s.photos);
  const setFacesOpen = useStore((s) => s.setFacesOpen);
  const patchPhoto = useStore((s) => s.patchPhoto);
  const setRating = useStore((s) => s.setRating);
  const toast = useStore((s) => s.toast);

  const [phase, setPhase] = useState('idle'); // idle | scanning | done
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setFacesOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setFacesOpen]);

  async function scan() {
    setPhase('scanning');
    setProgress(0);
    let done = 0;
    for (const p of photos) {
      try {
        if (!p.faceInfo) {
          const info = await analyzeFaces(masterOf(p));
          await patchPhoto(p.id, { faceInfo: info });
        }
      } catch (err) {
        console.error('face analysis failed for', p.name, err);
      }
      done++;
      setProgress(done / photos.length);
    }
    setPhase('done');
  }

  const portraits = useMemo(
    () =>
      photos
        .filter((p) => p.faceInfo && p.faceInfo.faces > 0)
        .sort((a, b) => b.faceInfo.score - a.faceInfo.score),
    [photos]
  );
  const analyzed = photos.filter((p) => p.faceInfo).length;
  const best = portraits[0];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) setFacesOpen(false); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="faces-title"
        className="w-[620px] max-w-[94vw] max-h-[85vh] overflow-y-auto bg-lr-panel border border-lr-border rounded-xl shadow-2xl p-5"
      >
        <h2 id="faces-title" className="text-[15px] font-semibold text-white mb-1">Visages — tri assisté des portraits</h2>
        <p className="text-[12px] text-lr-text-dim mb-4">
          Identifie les meilleurs clichés selon la netteté des yeux et l'ouverture des yeux.
        </p>

        {phase === 'scanning' ? (
          <div className="py-6" role="status">
            <div className="h-1.5 bg-lr-border rounded-full overflow-hidden mb-2">
              <div className="h-full bg-lr-accent rounded-full transition-all" style={{ width: `${progress * 100}%` }} />
            </div>
            <p className="text-[12px] text-lr-text-dim text-center">Analyse des visages… {Math.round(progress * 100)} %</p>
          </div>
        ) : (
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={scan}
              disabled={photos.length === 0}
              className="h-9 px-4 rounded-md bg-lr-accent hover:bg-[#4db4ff] text-black text-[13px] font-semibold cursor-pointer disabled:opacity-50"
            >
              {analyzed === photos.length && photos.length > 0 ? 'Réanalyser' : 'Analyser les portraits'}
            </button>
            <span className="text-[12px] text-lr-text-dim">
              {analyzed}/{photos.length} photos analysées — {portraits.length} portrait{portraits.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {portraits.length > 0 && (
          <>
            <div className="space-y-2.5 mb-4">
              {portraits.map((p, i) => (
                <div
                  key={p.id}
                  className={`flex gap-3 items-center bg-lr-canvas border rounded-lg p-2.5 ${
                    i === 0 ? 'border-emerald-600/60' : 'border-lr-border'
                  }`}
                >
                  <div className="w-24 h-16 rounded overflow-hidden bg-black flex items-center justify-center shrink-0">
                    <img src={p.thumbUrl} alt={p.name} className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-[12px] text-white truncate">{p.name}</p>
                      {i === 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-600/20 border border-emerald-600/50 text-emerald-400 text-[10px] font-semibold shrink-0">
                          Meilleur portrait
                        </span>
                      )}
                      <span className="text-[11px] text-lr-text-dim shrink-0">
                        {p.faceInfo.faces} visage{p.faceInfo.faces > 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <ScoreBar label="Yeux nets" value={p.faceInfo.eyeSharpness} />
                      <ScoreBar label="Yeux ouverts" value={p.faceInfo.eyesOpen} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl font-semibold tabular-nums text-white">{p.faceInfo.score}</p>
                    <p className="text-[10px] text-lr-text-dim">score</p>
                  </div>
                </div>
              ))}
            </div>
            {best && (
              <button
                onClick={() => {
                  setRating(best.id, 5);
                  toast(`5★ attribuées à « ${best.name} »`, 'success');
                }}
                className="w-full h-9 rounded-md border border-emerald-700/60 text-emerald-400 hover:bg-emerald-950/40 text-[13px] font-medium cursor-pointer mb-2"
              >
                Attribuer 5★ au meilleur portrait
              </button>
            )}
          </>
        )}

        {phase === 'done' && portraits.length === 0 && (
          <p className="text-[13px] text-lr-text py-3 text-center">Aucun visage détecté dans le catalogue.</p>
        )}

        <div className="flex justify-end mt-2">
          <button
            onClick={() => setFacesOpen(false)}
            className="h-8 px-4 rounded-md border border-lr-border bg-lr-panel-2 text-[12px] hover:bg-[#303030] cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
