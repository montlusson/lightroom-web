import React, { useMemo, useState, useRef } from 'react';
import { useStore } from '../store';
import { RAW_EXTENSIONS } from '../lib/raw';
import Stars from './Stars';

const ACCEPT = ['image/*', ...[...RAW_EXTENSIONS].map((e) => `.${e}`)].join(',');

function formatSize(bytes) {
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} Mo`;
  return `${Math.round(bytes / 1e3)} Ko`;
}

function PhotoCell({ photo, selected, onSelect, onOpen, cellSize, stackCount, stackExpanded, onToggleStack, isStackChild }) {
  const setRating = useStore((s) => s.setRating);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(photo.id)}
      onDoubleClick={() => onOpen(photo.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(photo.id);
        if (e.key === ' ') { e.preventDefault(); onSelect(photo.id); }
      }}
      aria-label={`${photo.name}${selected ? ' (sélectionnée)' : ''}`}
      className={`group relative rounded-lg overflow-hidden bg-lr-panel-2 border-2 transition-colors cursor-pointer ${
        selected ? 'border-lr-accent' : 'border-transparent hover:border-lr-border'
      }`}
      style={{ width: cellSize }}
    >
      <div className="flex items-center justify-center bg-lr-canvas" style={{ height: cellSize * 0.75 }}>
        <img
          src={photo.thumbUrl}
          alt={photo.name}
          loading="lazy"
          className="max-w-full max-h-full object-contain"
          draggable={false}
        />
      </div>
      <div className="absolute top-1.5 left-1.5 flex gap-1">
        {photo.isRaw && (
          <span className="px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold text-lr-accent tracking-wide">
            RAW
          </span>
        )}
        {photo.edited && (
          <span className="px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold text-emerald-400" title="Photo retouchée">
            ✎
          </span>
        )}
        {photo.retouchCount > 0 && (
          <span
            className="px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold text-violet-400"
            title={`${photo.retouchCount} imperfections supprimées par l'IA`}
          >
            ✨
          </span>
        )}
        {isStackChild && (
          <span className="px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-lr-text-dim" title="Photo dans une pile">
            ⌞
          </span>
        )}
      </div>
      {stackCount > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleStack?.(photo.id);
          }}
          title={stackExpanded ? 'Replier la pile' : `Déplier la pile (${stackCount} photos)`}
          aria-expanded={stackExpanded}
          className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded bg-lr-accent/90 hover:bg-lr-accent text-black text-[11px] font-bold cursor-pointer"
        >
          ▣ {stackCount}
        </button>
      )}
      <div className="px-2 py-1.5 flex items-center justify-between gap-1">
        <p className="text-[11px] text-lr-text-dim truncate" title={photo.name}>
          {photo.name}
        </p>
        <Stars rating={photo.rating} onChange={(r) => setRating(photo.id, r)} size="text-[11px]" />
      </div>
    </div>
  );
}

export default function Library() {
  const photos = useStore((s) => s.photos);
  const selectedId = useStore((s) => s.selectedId);
  const selectPhoto = useStore((s) => s.selectPhoto);
  const openInDevelop = useStore((s) => s.openInDevelop);
  const deletePhoto = useStore((s) => s.deletePhoto);
  const importFiles = useStore((s) => s.importFiles);
  const loading = useStore((s) => s.loading);

  const setDuplicatesOpen = useStore((s) => s.setDuplicatesOpen);
  const setFacesOpen = useStore((s) => s.setFacesOpen);

  const [search, setSearch] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [filterType, setFilterType] = useState('all'); // all | raw | edited
  const [sort, setSort] = useState('date-desc');
  const [cellSize, setCellSize] = useState(220);
  const [expandedStacks, setExpandedStacks] = useState(() => new Set());
  const inputRef = useRef(null);

  // Stack sizes (duplicates piled under a leader photo).
  const stackSizes = useMemo(() => {
    const byId = new Set(photos.map((p) => p.id));
    const sizes = {};
    photos.forEach((p) => {
      if (p.stackId && byId.has(p.stackId)) sizes[p.stackId] = (sizes[p.stackId] || 0) + 1;
    });
    return sizes;
  }, [photos]);

  const filtered = useMemo(() => {
    const byId = new Set(photos.map((p) => p.id));
    let list = photos;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (minRating > 0) list = list.filter((p) => p.rating >= minRating);
    if (filterType === 'raw') list = list.filter((p) => p.isRaw);
    if (filterType === 'edited') list = list.filter((p) => p.edited);
    // Collapse stacks: only the leader is shown unless the stack is expanded.
    list = list.filter((p) => {
      if (!p.stackId || !byId.has(p.stackId) || p.stackId === p.id) return true;
      return expandedStacks.has(p.stackId);
    });
    const sorted = [...list];
    if (sort === 'date-desc') sorted.sort((a, b) => b.importedAt - a.importedAt);
    else if (sort === 'date-asc') sorted.sort((a, b) => a.importedAt - b.importedAt);
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'rating') sorted.sort((a, b) => b.rating - a.rating);
    return sorted;
  }, [photos, search, minRating, filterType, sort, expandedStacks]);

  const toggleStack = (leaderId) => {
    setExpandedStacks((prev) => {
      const next = new Set(prev);
      if (next.has(leaderId)) next.delete(leaderId);
      else next.add(leaderId);
      return next;
    });
  };

  const selected = photos.find((p) => p.id === selectedId);

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-12 shrink-0 bg-lr-panel border-b border-lr-border flex items-center gap-3 px-4">
        <label className="sr-only" htmlFor="lib-search">Rechercher</label>
        <input
          id="lib-search"
          type="search"
          placeholder="Rechercher…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-56 px-3 rounded-md bg-lr-canvas border border-lr-border text-[13px] placeholder:text-lr-text-dim focus:border-lr-accent"
        />
        <div className="flex items-center gap-1.5 text-[12px] text-lr-text-dim">
          <span>Note ≥</span>
          <Stars rating={minRating} onChange={setMinRating} />
        </div>
        <label className="sr-only" htmlFor="lib-type">Type</label>
        <select
          id="lib-type"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="h-8 px-2 rounded-md bg-lr-canvas border border-lr-border text-[12px] cursor-pointer"
        >
          <option value="all">Toutes</option>
          <option value="raw">RAW</option>
          <option value="edited">Retouchées</option>
        </select>
        <label className="sr-only" htmlFor="lib-sort">Trier</label>
        <select
          id="lib-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="h-8 px-2 rounded-md bg-lr-canvas border border-lr-border text-[12px] cursor-pointer"
        >
          <option value="date-desc">Plus récentes</option>
          <option value="date-asc">Plus anciennes</option>
          <option value="name">Nom</option>
          <option value="rating">Note</option>
        </select>
        <div className="w-px h-5 bg-lr-border" />
        <button
          onClick={() => setDuplicatesOpen(true)}
          disabled={photos.length < 2}
          className="h-8 px-3 rounded-md border border-lr-border bg-lr-panel-2 hover:bg-[#303030] text-[12px] cursor-pointer disabled:opacity-40"
          title="Détecter les images en double et les empiler"
        >
          ⧉ Doublons
        </button>
        <button
          onClick={() => setFacesOpen(true)}
          disabled={photos.length === 0}
          className="h-8 px-3 rounded-md border border-lr-border bg-lr-panel-2 hover:bg-[#303030] text-[12px] cursor-pointer disabled:opacity-40"
          title="Tri assisté des portraits (netteté et ouverture des yeux)"
        >
          ☺ Visages
        </button>
        <div className="flex-1" />
        {selected && (
          <button
            onClick={() => {
              if (window.confirm(`Supprimer « ${selected.name} » de la bibliothèque ?`)) {
                deletePhoto(selected.id);
              }
            }}
            className="h-8 px-3 rounded-md border border-red-900/60 text-red-400 hover:bg-red-950/40 text-[12px] cursor-pointer"
          >
            Supprimer
          </button>
        )}
        <div className="flex items-center gap-2 text-[12px] text-lr-text-dim">
          <span>Vignettes</span>
          <input
            type="range"
            min="140"
            max="360"
            value={cellSize}
            onChange={(e) => setCellSize(Number(e.target.value))}
            className="lr-slider w-28"
            aria-label="Taille des vignettes"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-lr-text-dim text-sm">Chargement de la bibliothèque…</p>
        ) : filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3">
            <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-lr-border flex items-center justify-center text-3xl text-lr-text-dim" aria-hidden="true">
              🖼
            </div>
            <p className="text-lg font-medium text-lr-text">
              {photos.length === 0 ? 'Votre bibliothèque est vide' : 'Aucune photo ne correspond aux filtres'}
            </p>
            {photos.length === 0 && (
              <>
                <p className="text-sm text-lr-text-dim max-w-md">
                  Glissez-déposez vos photos n'importe où, ou cliquez sur Importer.
                  Formats pris en charge : JPEG, PNG, WebP et RAW (DNG, CR2, CR3, NEF, ARW, RAF, ORF…).
                </p>
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
                  className="mt-1 h-10 px-6 rounded-md bg-lr-accent hover:bg-[#4db4ff] text-black text-sm font-semibold cursor-pointer"
                >
                  Importer des photos
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {filtered.map((p) => (
              <PhotoCell
                key={p.id}
                photo={p}
                selected={p.id === selectedId}
                onSelect={selectPhoto}
                onOpen={openInDevelop}
                cellSize={cellSize}
                stackCount={stackSizes[p.id] || 0}
                stackExpanded={expandedStacks.has(p.id)}
                onToggleStack={toggleStack}
                isStackChild={Boolean(p.stackId && p.stackId !== p.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="h-7 shrink-0 bg-lr-panel border-t border-lr-border flex items-center px-4 text-[11px] text-lr-text-dim gap-4">
        <span>{filtered.length} / {photos.length} photos</span>
        {selected && (
          <span className="truncate">
            {selected.name} — {selected.width}×{selected.height} — {formatSize(selected.size)}
            {selected.isRaw ? ` — RAW ${selected.format}` : ''}
          </span>
        )}
        <div className="flex-1" />
        <span>Double-clic ou D : développer · G : grille · 0–5 : note</span>
      </div>
    </div>
  );
}
