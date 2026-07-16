"use client";

import { useState } from "react";

const OPEN_URLS: Record<string, string> = {
  tiktok: "https://www.tiktok.com/upload",
  instagram: "https://www.instagram.com/",
  snapchat: "https://www.snapchat.com/",
};

/**
 * Channel-appropriate share action for one tracked link. WhatsApp opens with
 * the post pre-filled; TikTok/Instagram/Snapchat (no prefill APIs) copy the
 * caption + link and open the platform.
 */
export function TrackedLinkShare({
  channel,
  shortUrl,
  caption,
}: {
  channel: string;
  shortUrl: string;
  caption: string;
}) {
  const [copied, setCopied] = useState(false);
  const post = `${caption}\n${shortUrl}`;

  if (channel === "whatsapp") {
    return (
      <a
        href={`https://wa.me/?text=${encodeURIComponent(post)}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-9 items-center rounded-[9px] border-none bg-success px-3 text-[12.5px] font-bold text-white no-underline transition-colors hover:bg-success-deep"
      >
        Share
      </a>
    );
  }

  const openUrl = OPEN_URLS[channel];
  if (!openUrl) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(post);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          // clipboard unavailable — the platform still opens
        }
        window.open(openUrl, "_blank", "noopener");
      }}
      className={`inline-flex min-h-9 cursor-pointer items-center rounded-[9px] border-none px-3 text-[12.5px] font-bold text-white transition-colors ${
        copied ? "bg-success" : "bg-ink hover:bg-ink-2"
      }`}
    >
      {copied ? "Copied ✓" : "Share"}
    </button>
  );
}
