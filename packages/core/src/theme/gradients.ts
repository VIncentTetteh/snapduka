// Deterministic warm gradients, used wherever a product has no photo.
//
// This is the most identity-defining function in the product: it is what stands
// in for every missing image, so it is on screen more than almost anything else.
// The hash is seeded from the product id, so a given product always gets the
// same swatch — on web and on mobile, forever. Changing SWATCHES or the hash
// reshuffles every placeholder in the app, so don't, casually.
//
// The stops live here rather than a CSS string because React Native cannot parse
// `linear-gradient(...)`. Web formats them back into CSS via `gradientForSeed`.

/** Six muted, dusty earth tones. Order is part of the hash — do not reorder. */
export const GRADIENT_SWATCHES = [
  ["#E4D5BF", "#A8875D"], // sand → tan
  ["#D8DDD2", "#8B9683"], // sage → olive
  ["#E7D9D2", "#B08D7D"], // blush → clay
  ["#DCD8E0", "#8E879B"], // lilac → slate-violet
  ["#EADFCE", "#C7AE8A"], // cream → wheat
  ["#D5DDE0", "#7F949B"], // ice → steel blue
] as const;

export type GradientStops = (typeof GRADIENT_SWATCHES)[number];

/** The angle web uses for product placeholders. */
export const GRADIENT_ANGLE = 140;

/** One fixed gradient for every initials avatar and logo fallback. */
export const AVATAR_GRADIENT_STOPS = ["#D9C6A8", "#A8875D"] as const;
export const AVATAR_GRADIENT_ANGLE = 135;

/** The three-stop warm gradient behind hero mockups and the story card. */
export const HERO_GRADIENT_STOPS = ["#E4D5BF", "#C7AE8A", "#A8875D"] as const;

/**
 * Pick a swatch for a seed. Stable across clients and across releases.
 *
 * `| 0` keeps the running hash in int32 the way the original web implementation
 * did; removing it would change every assignment.
 */
export function gradientStopsForSeed(seed: string): GradientStops {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  // The modulo keeps this in range, but `noUncheckedIndexedAccess` cannot see
  // that; the fallback is unreachable rather than defensive.
  const index = Math.abs(hash) % GRADIENT_SWATCHES.length;
  return GRADIENT_SWATCHES[index] ?? GRADIENT_SWATCHES[0];
}

/** CSS form, for the web client. */
export function gradientForSeed(seed: string): string {
  const [from, to] = gradientStopsForSeed(seed);
  return `linear-gradient(${GRADIENT_ANGLE}deg,${from},${to})`;
}

/** Initials for an avatar: up to two leading characters, uppercased. */
export function initialsFor(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}
