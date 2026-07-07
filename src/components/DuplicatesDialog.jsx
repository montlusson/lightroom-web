import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { groupByHash } from '../lib/similarity';

export default function DuplicatesDialog() {
  const photos = useStore((s) => s.photos);
  const setDuplicatesOpen = useStore((s) => s.setDuplicatesOpen);
  const ensureHashes = useStore((s) => s.ensureHashes);
  const stackGroups = useStore((s) => s.stackGroups);
  const unstackAll = useStore((s) => s.unstackAll);

  const [phase, setPhase] = useState('idle'); // idle | scanning | done
  const [progress, setProgress] = useState(0);
  const [groups, setGroups] = useState([]);
  const [stacked, setStacked] = useState(false);

  const hasStacks = photos.some((p) => p.stackId);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setDuplicatesOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDuplicatesOpen]);

  async function scan() {
    setPhase('scanning');
    setProgress(0);
    try {
      const entries = await ensureHashes(setProgress);
      setGroups(groupByHash(entries));
      setPhase('done');
      setStacked(false);
    } catch (err) {
      console.error('duplicate scan failed', err);
      setPhase('idle');
    }
  }

  async function stack() {
    await stackGroups(groups);
    setStacked(true);
  }

  const byId = new Map(photos.map((p) => [p.id, p]));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) setDuplicatesOpen(false); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dup-title"
        className="w-[560px] max-w-[94vw] max-h-[85vh] overflow-y-auto bg-lr-panel border border-lr-border rounded-xl shadow-2xl p-5"
      >
        <h2 id="dup-title" className="text-[15px] font-semibold text-white mb-1">Recherche de doublons</h2>
        <p className="text-[12px] text-lr-text-dim mb-4">
          Détection automatique des images en double (hash perceptuel) et organisation en piles.
        </p>

        {phase === 'idle' && (
          <div className="text-center py-6">
            <button
              onClick={scan}
              disabled={photos.length < 2}
              className="h-10 px-6 rounded-md bg-lr-accent hover:bg-[#4db4ff] text-black text-[13px] font-semibold cursor-pointer disabled:opacity-50"
            >
              Analyser le catalogue ({photos.length} photos)
            </button>
          </div>
        )}

        {phase === 'scanning' && (
          <div className="py-6" role="status">
            <div className="h-1.5 bg-lr-border rounded-full overflow-hidden mb-2">
              <div className="h-full bg-lr-accent rounded-full transition-all" style={{ width: `${progress * 100}%` }} />
            </div>
            <p className="text-[12px] text-lr-text-dim text-center">Calcul des empreintes… {Math.round(progress * 100)} %</p>
          </div>
        )}

        {phase === 'done' && (
          <>
            {groups.length === 0 ? (
              <p className="text-[13px] text-lr-text py-4 text-center">
                ✓ Aucun doublon détecté dans le catalogue.
              </p>
            ) : (
              <>
                <p className="text-[13px] text-white mb-3">
                  {groups.length} groupe{groups.length > 1 ? 's' : ''} de doublons trouvé{groups.length > 1 ? 's' : ''} :
                </p>
                <div className="space-y-3 mb-4">
                  {groups.map((ids, gi) => (
                    <div key={gi} className="bg-lr-canvas border border-lr-border rounded-lg p-2.5">
                      <p className="text-[11px] text-lr-text-dim mb-2">Groupe {gi + 1} — {ids.length} images</p>
                      <div className="flex gap-2 flex-wrap">
                        {ids.map((id) => {
                          const p = byId.get(id);
                          return p ? (
                            <div key={id} className="w-20">
                              <div className="h-14 rounded overflow-hidden bg-black flex items-center justify-center">
                                <img src={p.thumbUrl} alt={p.name} className="max-w-full max-h-full object-contain" />
                              </div>
                              <p className="text-[10px] text-lr-text-dim truncate mt-0.5" title={p.name}>{p.name}</p>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={stack}
                  disabled={stacked}
                  className="w-full h-10 rounded-md bg-lr-accent hover:bg-[#4db4ff] text-black text-[13px] font-semibold cursor-pointer disabled:opacity-50 mb-2"
                >
                  {stacked ? '✓ Piles créées' : `Empiler les ${groups.length} groupe${groups.length > 1 ? 's' : ''}`}
                </button>
              </>
            )}
          </>
        )}

        <div className="flex justify-between items-center mt-2">
          {hasStacks ? (
            <button
              onClick={unstackAll}
              className="h-8 px-3 rounded-md border border-lr-border text-[12px] text-lr-text-dim hover:text-white hover:bg-lr-panel-2 cursor-pointer"
            >
              Tout désempiler
            </button>
          ) : <span />}
          <button
            onClick={() => setDuplicatesOpen(false)}
            className="h-8 px-4 rounded-md border border-lr-border bg-lr-panel-2 text-[12px] hover:bg-[#303030] cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
