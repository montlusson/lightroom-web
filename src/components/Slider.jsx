import React, { useId } from 'react';

export default function Slider({ label, value, min = -100, max = 100, step = 1, defaultValue = 0, onChange, format }) {
  const id = useId();
  const display = format ? format(value) : (step < 1 ? value.toFixed(2) : Math.round(value));
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between mb-0.5">
        <label
          htmlFor={id}
          onDoubleClick={() => onChange(defaultValue)}
          title="Double-clic : réinitialiser"
          className="text-[12px] text-lr-text-dim select-none cursor-pointer hover:text-lr-text"
        >
          {label}
        </label>
        <span className={`text-[12px] tabular-nums ${value !== defaultValue ? 'text-white' : 'text-lr-text-dim'}`}>
          {value > 0 && step >= 1 ? `+${display}` : display}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="lr-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
      />
    </div>
  );
}
