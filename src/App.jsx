import React, { useEffect, useCallback, useState } from 'react';
import { useStore, selectedPhoto } from './store';
import TopNav from './components/TopNav';
import Dashboard from './components/Dashboard';
import Library from './components/Library';
import Develop from './components/Develop';
import ExportDialog from './components/ExportDialog';
import ReelDialog from './components/ReelDialog';
import DuplicatesDialog from './components/DuplicatesDialog';
import FacesDialog from './components/FacesDialog';
import Toasts from './components/Toasts';

export default function App() {
  const module = useStore((s) => s.module);
  const hydrate = useStore((s) => s.hydrate);
  const importFiles = useStore((s) => s.importFiles);
  const importing = useStore((s) => s.importing);
  const importProgress = useStore((s) => s.importProgress);
  const exportDialogOpen = useStore((s) => s.exportDialogOpen);
  const reelOpen = useStore((s) => s.reelOpen);
  const duplicatesOpen = useStore((s) => s.duplicatesOpen);
  const facesOpen = useStore((s) => s.facesOpen);
  const photo = useStore(selectedPhoto);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Global drag & drop import
  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
    },
    [importFiles]
  );

  useEffect(() => {
    const onDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer?.types?.includes('Files')) setDragOver(true);
    };
    const onDragLeave = (e) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [onDrop]);

  // Keyboard: G = grid, D = develop, 0-5 = rating
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const s = useStore.getState();
      if (e.key === 'g' || e.key === 'G') s.setModule('library');
      else if (e.key === 'd' || e.key === 'D') s.setModule('develop');
      else if (/^[0-5]$/.test(e.key) && s.selectedId) s.setRating(s.selectedId, Number(e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="h-full flex flex-col bg-lr-bg text-lr-text">
      <TopNav />
      <main className="flex-1 min-h-0">
        {module === 'dashboard' && <Dashboard />}
        {module === 'library' && <Library />}
        {module === 'develop' && <Develop />}
      </main>

      {dragOver && (
        <div className="fixed inset-0 z-50 bg-black/70 border-4 border-dashed border-lr-accent rounded-xl m-3 flex items-center justify-center pointer-events-none fade-in">
          <div className="text-center">
            <div className="text-5xl mb-3" aria-hidden="true">⬇</div>
            <p className="text-xl font-semibold text-white">Déposez vos photos ici</p>
            <p className="text-lr-text-dim mt-1">JPEG, PNG, WebP et fichiers RAW (DNG, CR2, NEF, ARW…)</p>
          </div>
        </div>
      )}

      {importing && importProgress && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-lr-panel-2 border border-lr-border rounded-lg px-5 py-3 shadow-2xl flex items-center gap-4"
          role="status"
        >
          <svg className="animate-spin w-5 h-5 text-lr-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M12 2 A10 10 0 0 1 22 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div>
            <p className="text-sm font-medium">
              Importation… {importProgress.done}/{importProgress.total}
            </p>
            <div className="w-52 h-1 bg-lr-border rounded-full mt-1.5 overflow-hidden">
              <div
                className="h-full bg-lr-accent rounded-full transition-all"
                style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {exportDialogOpen && photo && <ExportDialog photo={photo} />}
      {reelOpen && <ReelDialog />}
      {duplicatesOpen && <DuplicatesDialog />}
      {facesOpen && <FacesDialog />}
      <Toasts />
    </div>
  );
}
