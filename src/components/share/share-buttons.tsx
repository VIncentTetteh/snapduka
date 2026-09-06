"use client";

import { useState } from "react";

import { NativeShareButton, useCanNativeShare } from "./native-share-button";

type ChannelLink = { channel: string; shortUrl: string };

/**
 * One-tap sharing, for a seller and for a creator alike — which is why this
 * lives under components/share rather than components/seller. A creator's post
 * kit is the same three things as a seller's (image, caption, tracked link);
 * only whose token is on the link differs, and the caller supplies that.
 *
 * On mobile, the native share sheet is the primary action —
 * it attaches the story-card image (the product photo, composited with
 * price/caption) directly, not just a link. WhatsApp/X/Facebook/Telegram
 * open with the post pre-filled via their web intents as a link-only
 * fallback. TikTok/Instagram/Snapchat have no public prefill intent, so
 * those buttons copy the caption (with the channel's tracked link) and open
 * the platform.
 */
export function ShareButtons({
  caption,
  storeUrl,
  links,
  storyCardUrl,
  shopName,
}: {
  caption: string;
  storeUrl: string;
  links: ChannelLink[];
  storyCardUrl: string;
  shopName: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const canNativeShare = useCanNativeShare();

  const linkFor = (channel: string) =>
    links.find((link) => link.channel === channel)?.shortUrl ?? storeUrl;

  const text = (channel: string) => `${caption}\n${linkFor(channel)}`;

  async function copyFor(channel: string, label: string, openUrl: string) {
    try {
      await navigator.clipboard.writeText(text(channel));
      setNotice(`Caption + tracked link copied — paste it in ${label}.`);
    } catch {
      setNotice(`Could not copy — use the Copy buttons above, then post in ${label}.`);
    }
    window.open(openUrl, "_blank", "noopener");
  }

  const intentButton =
    "inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-none px-3.5 text-[12.5px] font-bold text-white no-underline transition-opacity hover:opacity-90";
  const copyButton =
    "inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-line-strong bg-white px-3.5 text-[12.5px] font-bold text-ink transition-colors hover:border-[#B9AC98]";

  return (
    <div className="grid gap-3">
      {canNativeShare ? (
        <NativeShareButton
          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] border-none bg-accent px-4 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:opacity-60"
          fallbackUrl={storeUrl}
          imageFilename="snapduka-story.png"
          imageUrl={storyCardUrl}
          label="Share photo + caption…"
          pendingLabel="Preparing…"
          text={text("other")}
          title={shopName}
        />
      ) : (
        <p className="m-0 text-[12px] text-ink-muted">
          On your phone, sharing here attaches the product photo directly — open this page on
          mobile to try it. From a computer, use the buttons below (link only).
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* Pre-filled post intents */}
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text("whatsapp"))}`}
          target="_blank"
          rel="noreferrer"
          className={intentButton}
          style={{ background: "#1FAF38" }}
        >
          WhatsApp
        </a>
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}&url=${encodeURIComponent(linkFor("other"))}`}
          target="_blank"
          rel="noreferrer"
          className={intentButton}
          style={{ background: "#211B14" }}
        >
          X
        </a>
        <a
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(linkFor("other"))}&quote=${encodeURIComponent(caption)}`}
          target="_blank"
          rel="noreferrer"
          className={intentButton}
          style={{ background: "#1877F2" }}
        >
          Facebook
        </a>
        <a
          href={`https://t.me/share/url?url=${encodeURIComponent(linkFor("other"))}&text=${encodeURIComponent(caption)}`}
          target="_blank"
          rel="noreferrer"
          className={intentButton}
          style={{ background: "#2AABEE" }}
        >
          Telegram
        </a>

        {/* Copy-and-open (no prefill APIs exist) */}
        <button
          type="button"
          className={copyButton}
          onClick={() => copyFor("tiktok", "TikTok", "https://www.tiktok.com/upload")}
        >
          TikTok
        </button>
        <button
          type="button"
          className={copyButton}
          onClick={() => copyFor("instagram", "Instagram", "https://www.instagram.com/")}
        >
          Instagram
        </button>
        <button
          type="button"
          className={copyButton}
          onClick={() => copyFor("snapchat", "Snapchat", "https://www.snapchat.com/")}
        >
          Snapchat
        </button>
        <a href={storyCardUrl} download="snapduka-story.png" className={copyButton}>
          Save image
        </a>
      </div>

      <p aria-live="polite" role="status" className="m-0 min-h-4 text-[12px] text-ink-muted">
        {notice ??
          "WhatsApp, X, Facebook and Telegram open with your post ready. TikTok, Instagram and Snapchat don't allow pre-filled posts — those buttons copy your caption and open the app."}
      </p>
    </div>
  );
}
