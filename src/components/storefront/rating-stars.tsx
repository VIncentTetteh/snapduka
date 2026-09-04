/**
 * A rating, drawn.
 *
 * Five outlined stars with a clipped overlay of filled ones, so 4.3 reads as
 * 4.3 rather than rounding to 4 — the difference between "good" and "nearly
 * perfect" is exactly what a buyer is scanning for.
 *
 * Hand-rolled SVG like every other icon in this codebase; there is no icon
 * library.
 */

const STAR_PATH =
  "M8 1.6l1.94 3.93 4.34.63-3.14 3.06.74 4.32L8 11.5l-3.88 2.04.74-4.32L1.72 6.16l4.34-.63L8 1.6z";

function StarRow({ colour, ariaHidden = true }: { colour: string; ariaHidden?: boolean }) {
  return (
    <span aria-hidden={ariaHidden} className="flex gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 16 16" fill={colour}>
          <path d={STAR_PATH} />
        </svg>
      ))}
    </span>
  );
}

export function RatingStars({
  rating,
  count,
  showCount = true,
}: {
  rating: number;
  count?: number;
  /** Off on dense grid cards, where the count is noise. */
  showCount?: boolean;
}) {
  const clamped = Math.max(0, Math.min(5, rating));
  const label =
    count === undefined
      ? `Rated ${clamped.toFixed(1)} out of 5`
      : `Rated ${clamped.toFixed(1)} out of 5 from ${count} review${count === 1 ? "" : "s"}`;

  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className="relative inline-flex" role="img" aria-label={label}>
        <StarRow colour="#EAE2D6" />
        {/* The filled row is clipped to the fraction earned, which is what makes
            a half star possible without a second set of glyphs. */}
        <span
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${(clamped / 5) * 100}%` }}
        >
          <StarRow colour="#A8431A" />
        </span>
      </span>
      {showCount && count !== undefined ? (
        <span className="text-[12px] text-ink-muted">
          {clamped.toFixed(1)} ({count})
        </span>
      ) : null}
    </span>
  );
}
