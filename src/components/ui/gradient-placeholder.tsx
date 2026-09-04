import {
  AVATAR_GRADIENT_ANGLE,
  AVATAR_GRADIENT_STOPS,
  gradientForSeed,
  initialsFor,
} from "@snapduka/core";

// The swatches and the seed hash now live in @snapduka/core so the mobile app
// renders the identical placeholder for the identical product. This file stays
// as the web import site — 16 modules import from it — and only supplies the
// DOM wrapper.
export { gradientForSeed };

const AVATAR_GRADIENT = `linear-gradient(${AVATAR_GRADIENT_ANGLE}deg,${AVATAR_GRADIENT_STOPS[0]},${AVATAR_GRADIENT_STOPS[1]})`;

/** Warm gradient block used when a product has no photo. */
export function GradientPlaceholder({
  seed,
  className = "",
}: {
  seed: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block ${className}`}
      style={{ background: gradientForSeed(seed) }}
    />
  );
}

/** Initials avatar circle with the warm avatar gradient. */
export function InitialsAvatar({
  name,
  className = "h-9 w-9 text-[13px]",
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-bold text-white ${className}`}
      style={{ background: AVATAR_GRADIENT }}
    >
      {initialsFor(name)}
    </span>
  );
}
