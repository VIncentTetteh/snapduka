import { ImageResponse } from "next/og";

import { mainImageUrl } from "@/lib/storefront/media";
import { getPublicProduct, getPublicShop } from "@/lib/storefront/queries";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Product on SnapDuka";

/**
 * The unfurl for a single product — the most-shared link in the product.
 *
 * A product link previously declared no image at all, with
 * `twitter:card: summary`, so a creator posting about one item got a bare title
 * and no picture. That is the moment the link is competing with everything else
 * in a WhatsApp thread, and a picture is most of what makes it worth tapping.
 *
 * The product photo is the whole card where one exists, with the name and price
 * over a scrim so they stay readable against a light or busy image. Shops
 * without a photo fall back to the same warm gradient the story card uses, so
 * the card is never empty.
 */
const FALLBACK_GRADIENT = "linear-gradient(160deg, #E4D5BF 0%, #C7AE8A 55%, #A8875D 100%)";

/**
 * Currency symbols are missing from the generator's built-in font and trigger
 * failed dynamic-font fetches, so the card uses plain codes — the same reason
 * and the same treatment as `cardPrice` in api/share/story-card.
 */
function cardPrice(minor: number, currency: string): string {
  if (currency === "XOF") return `XOF ${minor.toLocaleString("en-US")}`;
  return `${currency} ${(minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function ProductOpenGraphImage({
  params,
}: {
  params: Promise<{ slug: string; productId: string }>;
}) {
  const { slug, productId } = await params;
  const shop = await getPublicShop(slug);
  const product = shop ? await getPublicProduct(shop.id, productId) : null;
  const photo = product ? mainImageUrl(product.product_media) : null;

  return new ImageResponse(
    (
      <div
        style={{
          background: photo ? "#211B14" : FALLBACK_GRADIENT,
          display: "flex",
          height: "100%",
          position: "relative",
          width: "100%",
        }}
      >
        {photo ? (
          // Satori renders this, not the browser, so next/image does not apply.
          <img
            alt=""
            src={photo}
            style={{ height: "100%", objectFit: "cover", width: "100%" }}
          />
        ) : null}

        {/* Dark from the bottom so the text is legible over any photo. Three
            stops rather than two: a single ramp from 35% left the shop name and
            price sitting on a bright product shot with too little contrast, and
            product photography here is mostly light backgrounds. */}
        <div
          style={{
            background:
              "linear-gradient(180deg, rgba(33,27,20,0) 20%, rgba(33,27,20,0.62) 52%, rgba(33,27,20,0.97) 100%)",
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            left: 0,
            padding: 64,
            position: "absolute",
            right: 0,
            top: 0,
          }}
        >
          <div style={{ color: "#D9986F", fontSize: 24, fontWeight: 600, letterSpacing: 5 }}>
            {(shop?.display_name ?? "SNAPDUKA").toUpperCase()}
          </div>
          <div
            style={{
              color: "#FAF7F2",
              fontFamily: "Georgia, serif",
              fontSize: 64,
              fontWeight: 500,
              lineHeight: 1.1,
              marginTop: 16,
            }}
          >
            {product?.name ?? "Product unavailable"}
          </div>
          {product ? (
            <div style={{ color: "#FAF7F2", fontSize: 44, fontWeight: 700, marginTop: 20 }}>
              {cardPrice(product.price_minor, product.currency)}
            </div>
          ) : null}
          <div style={{ color: "#B8AEA1", fontSize: 24, marginTop: 20 }}>
            Secure checkout · No account needed
          </div>
        </div>
      </div>
    ),
    size,
  );
}
