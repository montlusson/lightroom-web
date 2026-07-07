import React, { useCallback, useEffect, useRef, useState } from 'react';

export const CROP_ASPECTS = [
  { id: 'free', label: 'Libre', ratio: null },
  { id: 'original', label: 'Original', ratio: 'original' },
  { id: '1:1', label: 'Carré 1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16 (vertical)', ratio: 9 / 16 },
  { id: '4:5', label: '4:5 (portrait)', ratio: 4 / 5 },
];

const MIN_SIZE = 0.05;

function clampDraft(d) {
  const w = Math.max(MIN_SIZE, Math.min(1, d.w));
  const h = Math.max(MIN_SIZE, Math.min(1, d.h));
  return {
    x: Math.max(0, Math.min(1 - w, d.x)),
    y: Math.max(0, Math.min(1 - h, d.y)),
    w,
    h,
  };
}

// k = normalized width per normalized height for the target pixel aspect.
export function fitAspect(draft, k) {
  let h = draft.h;
  let w = h * k;
  if (w > draft.w) { w = draft.w; h = w / k; }
  if (w > 1) { w = 1; h = w / k; }
  if (h > 1) { h = 1; w = h * k; }
  return clampDraft({
    x: draft.x + (draft.w - w) / 2,
    y: draft.y + (draft.h - h) / 2,
    w,
    h,
  });
}

// Tracks the canvas position relative to its container (the canvas is
// centered and letterboxed by CSS, so the overlay must follow it).
function useCanvasRect(canvasRef, containerRef, deps) {
  const [rect, setRect] = useState(null);
  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const c = canvas.getBoundingClientRect();
    const p = container.getBoundingClientRect();
    if (c.width < 2 || c.height < 2) return;
    setRect({ left: c.left - p.left, top: c.top - p.top, width: c.width, height: c.height });
  }, [canvasRef, containerRef]);

  useEffect(() => {
    measure();
    const t = setTimeout(measure, 60); // after layout settles
    const ro = new ResizeObserver(measure);
    if (canvasRef.current) ro.observe(canvasRef.current);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return rect;
}

const HANDLES = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize', edge: true },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize', edge: true },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize', edge: true },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize', edge: true },
];

// Interactive crop overlay. draft/setDraft are in rotated-image space (0..1).
// aspectK: normalized w per normalized h, or null for free.
export default function CropTool({ canvasRef, containerRef, draft, setDraft, aspectK }) {
  const rect = useCanvasRect(canvasRef, containerRef, [draft !== null]);
  const drag = useRef(null);
  const rootRef = useRef(null);

  function onPointerDown(e, mode) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: { ...draft } };
    try { rootRef.current.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
  }

  function onPointerMove(e) {
    if (!drag.current || !rect) return;
    const { mode, startX, startY, start } = drag.current;
    const dx = (e.clientX - startX) / rect.width;
    const dy = (e.clientY - startY) / rect.height;

    if (mode === 'move') {
      setDraft(clampDraft({ ...start, x: start.x + dx, y: start.y + dy }));
      return;
    }

    // Anchor = fixed corner/edge opposite the dragged handle.
    let { x, y, w, h } = start;
    const right = x + w;
    const bottom = y + h;

    if (aspectK && mode.length === 2) {
      // Corner resize with locked aspect: anchor is the opposite corner.
      const ax = mode.includes('w') ? right : x;
      const ay = mode.includes('n') ? bottom : y;
      const px = mode.includes('w') ? x + dx : right + dx;
      const py = mode.includes('n') ? y + dy : bottom + dy;
      let nw = Math.max(Math.abs(px - ax), Math.abs(py - ay) * aspectK);
      // Clamp inside the frame while keeping the anchor fixed.
      const maxW = Math.min(
        mode.includes('w') ? ax : 1 - ax,
        (mode.includes('n') ? ay : 1 - ay) * aspectK
      );
      nw = Math.max(MIN_SIZE, Math.min(nw, maxW));
      const nh = nw / aspectK;
      setDraft({
        x: mode.includes('w') ? ax - nw : ax,
        y: mode.includes('n') ? ay - nh : ay,
        w: nw,
        h: nh,
      });
      return;
    }

    // Free resize.
    if (mode.includes('w')) { x = Math.min(start.x + dx, right - MIN_SIZE); w = right - x; }
    if (mode.includes('e')) { w = Math.max(MIN_SIZE, start.w + dx); }
    if (mode.includes('n')) { y = Math.min(start.y + dy, bottom - MIN_SIZE); h = bottom - y; }
    if (mode.includes('s')) { h = Math.max(MIN_SIZE, start.h + dy); }
    setDraft(clampDraft({ x, y, w, h }));
  }

  function onPointerUp(e) {
    drag.current = null;
    try { rootRef.current.releasePointerCapture(e.pointerId); } catch { /* released */ }
  }

  if (!rect || !draft) return null;

  const px = (v) => `${v * 100}%`;
  const box = {
    left: px(draft.x),
    top: px(draft.y),
    width: px(draft.w),
    height: px(draft.h),
  };

  return (
    <div
      ref={rootRef}
      className="absolute touch-none"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="application"
      aria-label="Zone de recadrage — glissez pour déplacer, poignées pour redimensionner"
    >
      {/* Dark shades outside the crop box */}
      <div className="absolute bg-black/60 pointer-events-none" style={{ left: 0, top: 0, right: 0, height: px(draft.y) }} />
      <div className="absolute bg-black/60 pointer-events-none" style={{ left: 0, top: px(draft.y + draft.h), right: 0, bottom: 0 }} />
      <div className="absolute bg-black/60 pointer-events-none" style={{ left: 0, top: px(draft.y), width: px(draft.x), height: px(draft.h) }} />
      <div className="absolute bg-black/60 pointer-events-none" style={{ left: px(draft.x + draft.w), top: px(draft.y), right: 0, height: px(draft.h) }} />

      {/* Crop box */}
      <div
        className="absolute border-2 border-white/90 cursor-move"
        style={box}
        onPointerDown={(e) => onPointerDown(e, 'move')}
      >
        {/* Rule-of-thirds grid */}
        {[1 / 3, 2 / 3].map((f) => (
          <React.Fragment key={f}>
            <div className="absolute top-0 bottom-0 w-px bg-white/35 pointer-events-none" style={{ left: px(f) }} />
            <div className="absolute left-0 right-0 h-px bg-white/35 pointer-events-none" style={{ top: px(f) }} />
          </React.Fragment>
        ))}
        {/* Handles */}
        {HANDLES.filter((hd) => !(aspectK && hd.edge)).map((hd) => (
          <div
            key={hd.id}
            onPointerDown={(e) => onPointerDown(e, hd.id)}
            className="absolute w-3.5 h-3.5 bg-white border border-black/60 rounded-[3px] -translate-x-1/2 -translate-y-1/2"
            style={{ left: px(hd.x), top: px(hd.y), cursor: hd.cursor }}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

// Red overlay preview of the selected mask, mapped through the crop window.
export function MaskOverlay({ canvasRef, containerRef, maskCanvas, crop }) {
  const rect = useCanvasRect(canvasRef, containerRef, [maskCanvas, crop]);
  const overlayRef = useRef(null);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !maskCanvas || !rect) return;
    el.width = Math.round(rect.width);
    el.height = Math.round(rect.height);
    const ctx = el.getContext('2d');
    ctx.clearRect(0, 0, el.width, el.height);
    // Tint the mask red.
    const tint = document.createElement('canvas');
    tint.width = maskCanvas.width;
    tint.height = maskCanvas.height;
    const tctx = tint.getContext('2d');
    tctx.drawImage(maskCanvas, 0, 0);
    tctx.globalCompositeOperation = 'multiply';
    tctx.fillStyle = '#ff2244';
    tctx.fillRect(0, 0, tint.width, tint.height);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(maskCanvas, 0, 0);
    const c = crop || { x: 0, y: 0, w: 1, h: 1 };
    ctx.drawImage(
      tint,
      c.x * maskCanvas.width, c.y * maskCanvas.height,
      c.w * maskCanvas.width, c.h * maskCanvas.height,
      0, 0, el.width, el.height
    );
  }, [maskCanvas, crop, rect]);

  if (!rect || !maskCanvas) return null;
  return (
    <canvas
      ref={overlayRef}
      className="absolute pointer-events-none opacity-45"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      aria-hidden="true"
    />
  );
}
