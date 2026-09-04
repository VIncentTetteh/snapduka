import { ImageResponse } from "next/og";
import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";

import { appHost } from "@/lib/app-url";
import { resolveServerActor } from "@/lib/auth/actor";
import { mainImageUrl, normalizeToOne, publicMediaUrl } from "@/lib/storefront/media";
import { createRequestScopedClient } from "@/lib/supabase/request";
export const dynamic = "force-dynamic";

/**
 * Currency symbols (₵, ₦) are missing from the generator's built-in font and
 * trigger failed dynamic-font fetches — use plain codes on the card.
 */
function cardPrice(minor: number, currency: string): string {
  if (currency === "XOF") return `XOF ${minor.toLocaleString("en-US")}`;
  return `${currency} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const WIDTH = 1080;
const HEIGHT = 1920;
const FALLBACK_GRADIENT = "linear-gradient(160deg, #E4D5BF 0%, #C7AE8A 55%, #A8875D 100%)";

/**
 * Story-card image (9:16, 1080×1920) for TikTok / Reels / Snapchat / Status.
 * Backed by the product's main photo (or the warm gradient), with the shop
 * logo, price and store link composed on top. Seller-only.
 *
 * `?campaign=<id>` makes it a campaign flyer instead: the campaign's own
 * creative behind it, its name as the headline, and — the part that matters —
 * a QR of the campaign's **tracked** /l/ link rather than the bare storefront,
 * so a flyer scanned off a wall or a stall is attributed like any other post.
 * A campaign with no creative falls back to the same warm gradient.
 */
export async function GET(request: NextRequest) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const productId = request.nextUrl.searchParams.get("product");
  const campaignId = request.nextUrl.searchParams.get("campaign");
  const supabase = await createRequestScopedClient();

  const { data: shop } = await supabase
    .from("shops")
    .select("slug, display_name, currency, shop_branding(logo_path)")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!shop) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  const logoUrl = publicMediaUrl(normalizeToOne(shop.shop_branding)?.logo_path, "shop-logos");

  let product: { name: string; price_minor: number; currency: string } | null = null;
  let backgroundUrl: string | null = null;
  let campaignName: string | null = null;
  let campaignToken: string | null = null;

  if (campaignId) {
    // RLS scopes campaigns to the caller, so an id that is not theirs simply
    // returns nothing and the card falls back to a plain storefront one.
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("name, creative_path")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaign) {
      campaignName = campaign.name;
      backgroundUrl = publicMediaUrl(campaign.creative_path, "campaign-media");

      // Any of the campaign's links will do — they all resolve to the same
      // destination, and each records the click against its own channel. The
      // flyer is a channel of its own really, so take the first consistently.
      const { data: link } = await supabase
        .from("campaign_links")
        .select("token")
        .eq("campaign_id", campaignId)
        .eq("active", true)
        .order("channel")
        .limit(1)
        .maybeSingle();
      campaignToken = link?.token ?? null;
    }
  }

  if (productId) {
    const { data } = await supabase
      .from("products")
      .select("name, price_minor, currency, product_media(object_path, position)")
      .eq("id", productId)
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle();
    if (data) {
      product = data;
      // A campaign's own creative wins: the seller chose it for this campaign.
      backgroundUrl = backgroundUrl ?? mainImageUrl(data.product_media);
    }
  }

  const host = await appHost();
  // A tracked link when there is one to use, so a scan off a printed flyer is
  // attributed instead of arriving as anonymous traffic.
  const storeLink = campaignToken ? `${host}/l/${campaignToken}` : `${host}/${shop.slug}`;
  const title = campaignName ?? product?.name ?? shop.display_name;
  const price = product ? cardPrice(product.price_minor, product.currency) : null;
  // Rendered at 2x the display size (132px) for a crisp scan off a phone
  // screen once the 1080-wide card is shrunk down in a chat/story preview.
  const qrDataUrl = await QRCode.toDataURL(`https://${storeLink}`, { width: 264, margin: 1 });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          background: FALLBACK_GRADIENT,
          fontFamily: "sans-serif",
        }}
      >
        {backgroundUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backgroundUrl}
            alt=""
            width={WIDTH}
            height={HEIGHT}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : null}

        {/* Readability overlays */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(33,27,20,0.35) 0%, rgba(33,27,20,0) 30%, rgba(33,27,20,0) 45%, rgba(33,27,20,0.82) 100%)",
          }}
        />

        {/* Top brand row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            padding: "72px 72px 0",
          }}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              width={96}
              height={96}
              style={{ borderRadius: 96, border: "4px solid #FAF7F2", objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: 96,
                background: "#A8431A",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 52,
                fontWeight: 700,
                border: "4px solid #FAF7F2",
              }}
            >
              {shop.display_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: "#FAF7F2",
              fontSize: 40,
              fontWeight: 700,
              textShadow: "0 2px 12px rgba(33,27,20,0.6)",
            }}
          >
            {shop.display_name}
            <svg width="40" height="40" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6.4" fill="#047857" />
              <path
                d="M4.4 7.2 6.2 9l3.4-3.8"
                stroke="#FFF"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Bottom panel */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: "auto",
            padding: "0 72px 96px",
            gap: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              color: "#FAF7F2",
              gap: 12,
            }}
          >
            <div
              style={{
                fontSize: 76,
                fontWeight: 700,
                lineHeight: 1.1,
                textShadow: "0 2px 16px rgba(33,27,20,0.55)",
              }}
            >
              {title}
            </div>
            {price ? (
              <div style={{ fontSize: 58, fontWeight: 700, color: "#F4E7D8" }}>{price}</div>
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: "#FAF7F2",
                color: "#211B14",
                borderRadius: 24,
                padding: "26px 40px",
                fontSize: 36,
                fontWeight: 700,
                maxWidth: WIDTH - 144 - 172,
              }}
            >
              Order at {storeLink}
            </div>
            {/* Scan-to-shop — same destination as the link above */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt=""
              width={132}
              height={132}
              style={{
                flexShrink: 0,
                borderRadius: 16,
                border: "6px solid #FAF7F2",
                background: "#FFFFFF",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              color: "rgba(250,247,242,0.85)",
              fontSize: 30,
            }}
          >
            <svg width="30" height="30" viewBox="0 0 18 18" fill="none">
              <path
                d="M3.5 9.5 7 13l7.5-8"
                stroke="#8FCDB0"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Secure Paystack checkout · No account needed
          </div>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}
