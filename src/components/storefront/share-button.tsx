"use client";

import { useState } from "react";

import { whatsappShareUrl } from "@/lib/storefront/sharing";

type Subject = "store" | "product";

const LABEL: Record<Subject, string> = { store: "Share store", product: "Share this product" };

export function ShareButton({
  title,
  url,
  subject = "store",
}: {
  title: string;
  url: string;
  subject?: Subject;
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // fall through when the user dismisses the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      return;
    } catch {
      // clipboard blocked or unavailable — fall through
    }
    // Desktop browsers without a share sheet, and any context where the
    // clipboard is blocked, previously left the button doing nothing at all.
    // WhatsApp is where these links get sent anyway.
    window.open(whatsappShareUrl(title, url), "_blank", "noopener,noreferrer");
  }

  return (
    <button
      type="button"
      aria-label={copied ? "Link copied" : LABEL[subject]}
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
