"use client";

import { useState } from "react";

export function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // clipboard unavailable
        }
      }}
      className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-[9px] border border-line-strong bg-white px-3 text-[12.5px] font-semibold transition-colors hover:border-[#B9AC98] ${
        copied ? "text-success" : "text-ink"
      } ${className}`}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
