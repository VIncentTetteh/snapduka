import type { ReactNode } from "react";

export type BadgeTone =
  | "success"
  | "warn"
  | "danger"
  | "neutral"
  | "accent"
  | "dark";

const TONES: Record<BadgeTone, string> = {
  success: "bg-success-tint text-success",
  warn: "bg-warn-tint text-warn",
  danger: "bg-danger-tint text-danger",
  neutral: "bg-neutral-tint text-ink-soft",
  accent: "bg-accent-tint text-accent",
  dark: "bg-ink text-paper",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function VerifiedBadge({ label = "Verified seller" }: { label?: string }) {
  return (
    <Badge tone="success">
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M2.5 7.2 5.5 10l6-6.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </Badge>
  );
}
