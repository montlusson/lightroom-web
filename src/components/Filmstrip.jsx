import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';

export default function Filmstrip() {
  const photos = useStore((s) => s.photos);
  const selectedId = useStore((s) => s.selectedId);
  const selectPhoto = useStore((s) => s.selectPhoto);
  const stripRef = useRef(null);

  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-id="${selectedId}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId]);

  return (
    <div
      ref={stripRef}
      className="h-[86px] shrink-0 bg-lr-panel border-t border-lr-border flex items-center gap-1.5 px-3 overflow-x-auto"
      role="listbox"
      aria-label="Pellicule"
    >
      {photos.map((p) => (
        <button
          key={p.id}
          data-id={p.id}
          role="option"
          aria-selected={p.id === selectedId}
          onClick={() => selectPhoto(p.id)}
          title={p.name}
          className={`shrink-0 h-[66px] w-[88px] rounded-md overflow-hidden border-2 bg-lr-canvas flex items-center justify-center transition-colors cursor-pointer ${
            p.id === selectedId ? 'border-lr-accent' : 'border-transparent hover:border-lr-border'
          }`}
        >
          <img src={p.thumbUrl} alt={p.name} className="max-w-full max-h-full object-contain" draggable={false} />
        </button>
      ))}
      {photos.length === 0 && (
        <p className="text-[12px] text-lr-text-dim px-2">Aucune photo — importez d'abord des images.</p>
      )}
    </div>
  );
}
