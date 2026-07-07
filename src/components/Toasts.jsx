import React from 'react';
import { useStore } from '../store';

const COLORS = {
  info: 'border-lr-border',
  success: 'border-green-600/60',
  error: 'border-red-600/60',
};

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-16 right-4 z-[60] flex flex-col gap-2 max-w-sm" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-enter bg-lr-panel-2 border ${COLORS[t.kind] || COLORS.info} rounded-lg px-4 py-2.5 text-[13px] shadow-xl`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
