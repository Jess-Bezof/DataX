"use client";

import { useState } from "react";

function StarIcon({ filled, half, className }: { filled: boolean; half?: boolean; className?: string }) {
  if (half) {
    return (
      <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
        <defs>
          <linearGradient id="halfStar">
            <stop offset="50%" stopColor="currentColor" />
            <stop offset="50%" stopColor="currentColor" stopOpacity={0.2} />
          </linearGradient>
        </defs>
        <path
          fill="url(#halfStar)"
          d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.2}
        d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
      />
    </svg>
  );
}

/** Display-only star rating for averages (supports half-stars) */
export function StarDisplay({
  value,
  count,
  size = "sm",
}: {
  value: number | null;
  count?: number;
  size?: "xs" | "sm" | "md";
}) {
  if (value === null) {
    return <span className="text-[var(--muted)] text-xs">No ratings</span>;
  }

  const sizeClass = size === "xs" ? "w-3 h-3" : size === "sm" ? "w-4 h-4" : "w-5 h-5";
  const textSize = size === "xs" ? "text-[10px]" : size === "sm" ? "text-xs" : "text-sm";

  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (value >= i) {
      stars.push(<StarIcon key={i} filled className={`${sizeClass} text-[var(--accent)]`} />);
    } else if (value >= i - 0.5) {
      stars.push(<StarIcon key={i} filled={false} half className={`${sizeClass} text-[var(--accent)]`} />);
    } else {
      stars.push(<StarIcon key={i} filled={false} className={`${sizeClass} text-[var(--muted)]/40`} />);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex gap-px">{stars}</span>
      <span className={`${textSize} text-[var(--muted)]`}>
        {value.toFixed(1)}
        {count != null && <span className="ml-0.5">({count})</span>}
      </span>
    </span>
  );
}

/** Interactive star input for submitting a rating */
export function StarInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (stars: number) => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(0);

  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => {
        const active = (hover || value) >= i;
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            className="p-0.5 transition disabled:opacity-40"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(i)}
            aria-label={`${i} star${i > 1 ? "s" : ""}`}
          >
            <StarIcon
              filled={active}
              className={`w-6 h-6 transition ${
                active ? "text-[var(--accent)]" : "text-[var(--muted)]/40"
              } ${disabled ? "" : "hover:text-[var(--accent)]"}`}
            />
          </button>
        );
      })}
    </span>
  );
}
