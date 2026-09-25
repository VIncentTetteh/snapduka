/**
 * The one loading indicator. Spins only for people who have not asked for
 * reduced motion; for everyone else it is a still ring, and the accompanying
 * label (visible or screen-reader only) says what is happening.
 */
export function Spinner({
  size = 16,
  className = "",
  label,
}: {
  size?: number;
  className?: string;
  /** Read out to screen readers. Omit when a visible label says the same. */
  label?: string;
}) {
  return (
    <span className={`inline-flex items-center ${className}`} role={label ? "status" : undefined}>
      <svg
        aria-hidden="true"
        className="motion-safe:animate-spin"
        fill="none"
        height={size}
        viewBox="0 0 24 24"
        width={size}
      >
        <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
