"use client";

import { useState, useSyncExternalStore } from "react";

function subscribeNever(): () => void {
  return () => {};
}

/**
 * True once hydrated on a browser that supports navigator.share. Server
 * always renders false to avoid a hydration mismatch; the client corrects
 * itself on mount.
 */
export function useCanNativeShare(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => typeof navigator !== "undefined" && "share" in navigator,
    () => false,
  );
}

/**
 * Shares an image (fetched from `imageUrl`) through the OS share sheet when
 * the browser supports file attachments — this is what lets a seller send
 * the actual product photo (via the story card, which embeds it) directly
 * into WhatsApp/Instagram/TikTok as an attachment, not just a link. Falls
 * back to a text+link share (no image) if the browser supports sharing but
 * not files. Callers should gate rendering on `useCanNativeShare()` and
 * show a text-based fallback UI when it's false (desktop browsers).
 */
export function NativeShareButton({
  imageUrl,
  imageFilename,
  title,
  text,
  fallbackUrl,
  label = "Share",
  pendingLabel = "Preparing…",
  className,
}: {
  imageUrl: string;
  imageFilename: string;
  title: string;
  text: string;
  fallbackUrl: string;
  label?: string;
  pendingLabel?: string;
  className?: string;
}) {
  const [sharing, setSharing] = useState(false);

  async function share() {
    setSharing(true);
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const file = new File([blob], imageFilename, { type: blob.type || "image/png" });
      const payload: ShareData = { title, text, files: [file] };
      if (navigator.canShare?.(payload)) {
        await navigator.share(payload);
        return;
      }
      // No file support — share text + link only.
      await navigator.share({ title, text, url: fallbackUrl });
    } catch {
      // User dismissed the sheet or share unsupported — nothing to do.
    } finally {
      setSharing(false);
    }
  }

  return (
    <button className={className} disabled={sharing} onClick={share} type="button">
      {sharing ? pendingLabel : label}
    </button>
  );
}
