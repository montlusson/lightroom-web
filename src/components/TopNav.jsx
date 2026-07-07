import React, { useRef } from 'react';
import { useStore } from '../store';
import { RAW_EXTENSIONS } from '../lib/raw';

const MODULES = [
  { id: 'dashboard', label: 'Tableau de bord' },
  { id: 'library', label: 'Bibliothèque' },
  { id: 'develop', label: 'Développement' },
];

const ACCEPT = ['image/*', ...[...RAW_EXTENSIONS].map((e) => `.${e}`)].join(',');

export default function TopNav() {
  const module = useStore((s) => s.module);
  const setModule = useStore((s) => s.setModule);
  const importFiles = useStore((s) => s.importFiles);
  const photos = useStore((s) => s.photos);
  const selectedId = useStore((s) => s.selectedId);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);
  const setReelOpen = useStore((s) => s.setReelOpen);
  const inputRef = useRef(null);

  return (
    <header className="h-14 shrink-0 bg-lr-panel border-b border-lr-border flex items-center px-4 gap-6 select-none">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-md border-2 border-lr-accent/80 bg-lr-accent/10 flex items-center justify-center">
          <span className="text-lr-accent font-bold text-sm tracking-tight">Lr</span>
        </div>
        <div className="leading-tight">
          <p className="font-semibold text-[15px] text-white">Lightroom Web</p>
          <p className="text-[11px] text-lr-text-dim -mt-0.5">
            {photos.length} photo{photos.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <nav className="flex items-center gap-1 ml-4" aria-label="Modules">
        {MODULES.map((m) => (
          <button
            key={m.id}
            onClick={() => setModule(m.id)}
            aria-current={module === m.id ? 'page' : undefined}
            className={`px-4 h-9 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
              module === m.id
                ? 'bg-lr-panel-2 text-white shadow-inner border border-lr-border'
                : 'text-lr-text-dim hover:text-lr-text hover:bg-lr-panel-2/60 border border-transparent'
            }`}
          >
            {m.label}
          </button>
        ))}
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) importFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          className="h-9 px-4 rounded-md bg-lr-accent hover:bg-[#4db4ff] text-black text-[13px] font-semibold transition-colors cursor-pointer"
        >
          Importer
        </button>
        <button
          onClick={() => setReelOpen(true)}
          disabled={photos.length === 0}
          className="h-9 px-4 rounded-md border border-lr-border bg-lr-panel-2 hover:bg-[#303030] text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          title="Créer une vidéo à partir de photos"
        >
          🎬 Reel
        </button>
        <button
          onClick={() => setExportDialogOpen(true)}
          disabled={!selectedId}
          className="h-9 px-4 rounded-md border border-lr-border bg-lr-panel-2 hover:bg-[#303030] text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Exporter
        </button>
      </div>
    </header>
  );
}
