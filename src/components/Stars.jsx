import React from 'react';

export default function Stars({ rating = 0, onChange, size = 'text-[13px]' }) {
  return (
    <div className={`flex items-center gap-0.5 ${size}`} role="group" aria-label={`Note : ${rating} sur 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={(e) => {
            e.stopPropagation();
            onChange?.(rating === n ? 0 : n);
          }}
          aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
          className={`cursor-pointer leading-none p-0.5 transition-colors ${
            n <= rating ? 'text-amber-400' : 'text-[#4a4a4a] hover:text-[#6a6a6a]'
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
