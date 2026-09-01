import type { CurrencyCode } from "../countries/types";
import { formatMoney } from "../i18n";

/**
 * The channels a seller can generate a tracked share link for.
 *
 * The token suffix is part of the link a buyer clicks, so it is not cosmetic:
 * web and mobile must derive the same token for the same channel or the two
 * clients create competing links for one destination and the attribution splits
 * across them. That is why this lives in core rather than being restated in
 * each app.
 */
export const SHARE_CHANNELS = ["whatsapp", "instagram", "tiktok", "snapchat"] as const;

export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/** Single character appended to a link's base token, per channel. */
export const CHANNEL_TOKEN_SUFFIX: Record<ShareChannel, string> = {
  tiktok: "t",
  instagram: "i",
  snapchat: "s",
  whatsapp: "w",
};

export const CHANNEL_LABEL: Record<ShareChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  tiktok: "TikTok",
  snapchat: "Snapchat",
};

/**
 * Whether the platform accepts a pre-filled post via a public URL.
 *
 * WhatsApp does. Instagram, TikTok and Snapchat have no such interface, so the
 * only honest thing to offer there is "copy the caption and open the app" —
 * pretending otherwise produces a button that opens an empty composer and looks
 * broken.
 */
export const CHANNEL_SUPPORTS_PREFILL: Record<ShareChannel, boolean> = {
  whatsapp: true,
  instagram: false,
  tiktok: false,
  snapchat: false,
};

/** Where a link for `destinationPath` points once shortened. */
export function shortLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/l/${token}`;
}

/** Storefront path for a shop, and the path for one of its products. */
export function storefrontPath(shopSlug: string): string {
  return `/${shopSlug}`;
}

export function productPath(shopSlug: string, productId: string): string {
  return `/${shopSlug}/products/${productId}`;
}

/**
 * The caption offered alongside the link.
 *
 * Kept here so the wording a seller sees is the same on both clients — it is
 * the thing they actually post, and two apps drifting on it is the kind of
 * inconsistency sellers notice and support cannot explain.
 */
export function shareCaption(input: {
  shopName: string;
  product?: { name: string; priceMinor: number; currency: CurrencyCode; videoUrl?: string | null };
}): string {
  if (!input.product) {
    return `Shop ${input.shopName} — secure checkout, no account needed. 🛍️`;
  }
  const { name, priceMinor, currency, videoUrl } = input.product;
  const watch = videoUrl ? `\nWatch: ${videoUrl}` : "";
  return `${name} — ${formatMoney(priceMinor, currency)}. Order in two taps, pay securely. 🛍️${watch}`;
}
