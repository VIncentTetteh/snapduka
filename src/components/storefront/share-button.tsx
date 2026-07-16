"use client";

import { useState } from "react";

export function ShareButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // fall through to clipboard when the user dismisses the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable — nothing else to do
    }
  }

  return (
    <button
      type="button"
      aria-label={copied ? "Link copied" : "Share store"}
      onClick={share}
      className="grid h-10 w-10 cursor-pointer place-items-center rounded-[10px] border border-line-input bg-white text-ink-soft transition-colors hover:bg-line-soft"
    >
      {copied ? (
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M3.5 9.5 7 13l7.5-8" stroke="#047857" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M13.5 6.5 6.8 9.6m0 .9 6.7 3M16 5a2.2 2.2 0 1 1-4.4 0A2.2 2.2 0 0 1 16 5ZM8.4 10a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Zm7.6 5a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
