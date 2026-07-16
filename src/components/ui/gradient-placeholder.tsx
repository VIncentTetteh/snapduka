const SWATCHES = [
  "linear-gradient(140deg,#E4D5BF,#A8875D)",
  "linear-gradient(140deg,#D8DDD2,#8B9683)",
  "linear-gradient(140deg,#E7D9D2,#B08D7D)",
  "linear-gradient(140deg,#DCD8E0,#8E879B)",
  "linear-gradient(140deg,#EADFCE,#C7AE8A)",
  "linear-gradient(140deg,#D5DDE0,#7F949B)",
] as const;

export function gradientForSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return SWATCHES[Math.abs(hash) % SWATCHES.length];
}

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
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#D9C6A8,#A8875D)] font-bold text-white ${className}`}
    >
      {initials || "?"}
    </span>
  );
}
