export function canonicalStorefrontUrl(
  origin: string,
  shopSlug: string,
  productId?: string,
): string {
  const base = origin.replace(/\/+$/, "");
  const shopUrl = `${base}/${encodeURIComponent(shopSlug)}`;
  return productId
    ? `${shopUrl}/products/${encodeURIComponent(productId)}`
    : shopUrl;
}

export function whatsappShareUrl(title: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(
    `Shop ${title} on SnapDuka: ${url}`,
  )}`;
}

export async function shareStorefront(
  navigatorLike: { share?: (data: ShareData) => Promise<void> },
  title: string,
  url: string,
): Promise<"shared" | string> {
  if (navigatorLike.share) {
    await navigatorLike.share({ title, text: `Shop ${title} on SnapDuka`, url });
    return "shared";
  }

  return whatsappShareUrl(title, url);
}
