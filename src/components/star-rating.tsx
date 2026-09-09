"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Star } from "lucide-react";

interface StarRatingProps {
  value: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}

const STEPS = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);

function ratingLabel(value: number | null) {
  return value === null ? "Not rated" : `${value} out of 5 stars`;
}

function RatingStar({ fill, size }: { fill: number; size: number }) {
  return <span className="relative block shrink-0" style={{ width: size, height: size }} aria-hidden="true">
    <Star size={size} strokeWidth={1.25} className="text-muted-foreground" />
    <span className="absolute inset-y-0 left-0 overflow-hidden text-foreground" style={{ width: `${fill * 100}%` }}>
      <Star size={size} strokeWidth={1.25} fill="currentColor" className="max-w-none" />
    </span>
  </span>;
}

export function StarRating({ value, onChange, disabled = false, compact = false, label = "Your rating" }: StarRatingProps) {
  const helpId = useId();
  const [preview, setPreview] = useState<number | null>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const rating = value !== null && Number.isFinite(value) && value > 0 ? Math.min(5, Math.round(value * 2) / 2) : null;
  const shown = preview ?? rating ?? 0;

  if (!onChange) {
    return <span className={`inline-flex items-center ${compact ? "gap-0.5" : "gap-1"}`} role="img" aria-label={`${label}: ${ratingLabel(rating)}`} title={ratingLabel(rating)}>
      {Array.from({ length: 5 }, (_, index) => <RatingStar key={index} fill={Math.max(0, Math.min(1, (rating ?? 0) - index))} size={compact ? 12 : 16} />)}
    </span>;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled) return;
    if (["Delete", "Backspace"].includes(event.key)) {
      event.preventDefault();
      setPreview(null);
      onChange!(null);
      return;
    }
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(STEPS.length - 1, index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = STEPS.length - 1;
    else return;
    event.preventDefault();
    setPreview(null);
    onChange!(STEPS[next]);
    buttons.current[next]?.focus();
  }

  return <div>
    <div className="inline-flex max-w-full items-center data-[disabled=true]:opacity-40" role="radiogroup" aria-label={label} aria-describedby={helpId} aria-disabled={disabled} data-disabled={disabled} onPointerLeave={() => setPreview(null)}>
      {Array.from({ length: 5 }, (_, starIndex) => <span key={starIndex} className="relative flex h-11 w-12 shrink-0 items-center justify-center">
        <RatingStar fill={Math.max(0, Math.min(1, shown - starIndex))} size={compact ? 18 : 24} />
        {[0, 1].map((half) => {
          const index = starIndex * 2 + half;
          const step = STEPS[index];
          const checked = rating === step;
          return <button key={half} ref={(node) => { buttons.current[index] = node; }} type="button" role="radio" aria-checked={checked} aria-label={`${step} ${step === 1 ? "star" : "stars"}${checked ? ", selected; activate again to clear" : ""}`} title={checked ? "Clear rating" : `Rate ${step} ${step === 1 ? "star" : "stars"}`} tabIndex={checked || (rating === null && index === 0) ? 0 : -1} disabled={disabled} className={`absolute inset-y-0 w-6 rounded-sm focus-visible:outline-foreground focus-visible:outline-offset-0 ${half === 0 ? "left-0" : "right-0"}`} onPointerMove={(event) => { if (event.pointerType === "mouse" && !disabled) setPreview(step); }} onBlur={() => setPreview(null)} onKeyDown={(event) => handleKeyDown(event, index)} onClick={() => { setPreview(null); onChange(checked ? null : step); }} />;
        })}
      </span>)}
    </div>
    <p id={helpId} className="sr-only">Select the left half of a star for a half rating or the right half for a full star. Select the same rating again to clear it. Use arrow keys to change by half a star, Home or End to jump, and Delete or Backspace to clear.</p>
  </div>;
}
