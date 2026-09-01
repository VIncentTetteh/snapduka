import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AnalyticsTracker } from "@/components/storefront/analytics-tracker";
import { ProductGallery, type VideoSlide } from "@/components/storefront/product-gallery";
import { fulfillmentSummary } from "@/lib/storefront/fulfillment-summary";
import type { VideoProvider } from "@/lib/catalog/video";
import { PurchaseActions } from "@/components/storefront/purchase-actions";
import { RestockForm } from "@/components/storefront/restock-form";
import { StoreHeader } from "@/components/storefront/store-header";
import { gradientForSeed } from "@/components/ui/gradient-placeholder";
import { deriveAvailability } from "@/lib/catalog/inventory";
import { normalizeToOne, publicMediaUrl } from "@/lib/storefront/media";
import { formatPrice } from "@/lib/storefront/price";
import { getPublicProduct, getPublicShop } from "@/lib/storefront/queries";
import { appOrigin } from "@/lib/app-url";
import { canonicalStorefrontUrl } from "@/lib/storefront/sharing";

type Props = {
  params: Promise<{ slug: string; productId: string }>;
  searchParams: Promise<{ campaign?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, productId } = await params;
  const shop = await getPublicShop(slug);
  if (!shop) return {};
  const product = await getPublicProduct(shop.id, productId);
  if (!product) return {};
  const url = canonicalStorefrontUrl(await appOrigin(), slug, productId);
  return {
    title: `${product.name} | ${shop.display_name}`,
    description: product.description,
    alternates: { canonical: url },
    openGraph: { title: product.name, url },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const [{ slug, productId }, query] = await Promise.all([params, searchParams]);
  const shop = await getPublicShop(slug);
  if (!shop) notFound();
  const product = await getPublicProduct(shop.id, productId);
  if (!product) notFound();

  const availability = deriveAvailability({
    policy: product.inventory_policy,
    stock: product.stock_quantity,
    reserved: product.reserved_quantity,
  });
  const variants = product.product_variants ?? [];
  const soldOut =
    variants.length > 0
      ? variants.every(
          (variant) =>
            variant.inventory_policy === "track" &&
            (variant.stock_quantity ?? 0) - variant.reserved_quantity <= 0,
        )
      : availability === "sold_out";
  const availableStock =
    product.inventory_policy === "track" && product.stock_quantity != null
      ? Math.max(0, product.stock_quantity - product.reserved_quantity)
      : null;

  const imageUrls = (product.product_media ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((media) => publicMediaUrl(media.object_path))
    .filter((url): url is string => Boolean(url));

  const videoSlide: VideoSlide | null =
    product.video_url && product.video_provider
      ? {
          provider: product.video_provider as VideoProvider,
          videoId: product.video_id,
          videoUrl: product.video_url,
          thumbnailUrl: product.video_thumbnail_url,
        }
      : null;

  const heroGradient = gradientForSeed(product.id);
  const priceLabel = formatPrice(product.price_minor, product.currency);
  const compareAtPriceLabel =
    product.compare_at_price_minor == null
      ? null
      : formatPrice(product.compare_at_price_minor, product.currency);
  const canonicalUrl = canonicalStorefrontUrl(await appOrigin(), slug, productId);

  return (
    <main className="sd-main min-h-svh bg-paper pb-24 text-ink sm:pb-10">
      <AnalyticsTracker
        campaign={query.campaign}
        country={shop.country}
        eventType="product_view"
        productId={product.id}
        shopId={shop.id}
      />
      <StoreHeader
        backHref={`/${slug}`}
        canonicalUrl={canonicalUrl}
        country={shop.country}
        fulfillment={fulfillmentSummary(shop.fulfillment_methods)}
        logoUrl={publicMediaUrl(normalizeToOne(shop.shop_branding)?.logo_path, "shop-logos")}
        name={shop.display_name}
        shareSubject="product"
        shareTitle={product.name}
        slug={slug}
        verified={Boolean(shop.verified_at)}
      />

      <div className="mx-auto max-w-[900px] px-4 pb-10 pt-5">
        <div className="grid items-start gap-6 md:grid-cols-2 md:gap-10">
          {/* Photos */}
          <div>
            <ProductGallery
              fallbackGradient={heroGradient}
              images={imageUrls}
              productName={product.name}
              video={videoSlide}
            />
          </div>

          {/* Details */}
          <div>
            <h1 className="mb-2 max-w-none font-serif text-[clamp(22px,3vw,28px)] font-medium tracking-[-0.01em]">
              {product.name}
            </h1>
            <p className="mb-3.5 flex items-center gap-2.5">
              {compareAtPriceLabel ? (
                <span className="text-[15px] font-semibold text-ink-faint line-through">{compareAtPriceLabel}</span>
              ) : null}
              <span className="text-[20px] font-bold text-price">{priceLabel}</span>
            </p>
            {product.description ? (
              <p className="mb-5 whitespace-pre-wrap text-[14px] leading-[1.65] text-ink-soft">
                {product.description}
              </p>
            ) : null}

            {soldOut ? <RestockForm productId={product.id} /> : null}

            <PurchaseActions
              availableStock={availableStock}
              campaign={query.campaign}
              currency={product.currency}
              priceMinor={product.price_minor}
              productId={product.id}
              shopSlug={slug}
              soldOut={soldOut}
              variants={variants}
            />

            {/* Trust rows */}
            <div className="mt-4 grid gap-2.5 border-t border-line pt-4">
              <p className="m-0 flex items-center gap-2.5 text-[12.5px] text-ink-soft">
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="flex-none text-success">
                  <path d="M3.5 9.5 7 13l7.5-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {/*
                  Was "Secure payment with Paystack · card or mobile money".
                  Online payments require an active subaccount
                  (checkout/page.tsx:150) and 4 of the 5 live shops have none —
                  those buyers were promised card and mobile money, then offered
                  cash on delivery. The storefront cannot read
                  payment_subaccounts (owner/operator RLS), so this states only
                  what holds for every shop.
                */}
                Payment options shown at checkout
              </p>
              <p className="m-0 flex items-center gap-2.5 text-[12.5px] text-ink-soft">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="flex-none text-price">
                  <path d="M2.5 5.5h9v8h-9v-8Zm9 2.5h3.2l2.3 2.5v3h-2.3m-9.4 0h6.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Delivery and pickup options shown at checkout
              </p>
              <p className="m-0 flex items-center gap-2.5 text-[12.5px] text-ink-soft">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="flex-none text-price">
                  <path d="M10 2.5a7.5 7.5 0 0 0-6.4 11.4L2.5 17.5l3.7-1A7.5 7.5 0 1 0 10 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
                Questions? Message the seller on WhatsApp before you buy
              </p>
              <p className="m-0 text-[11.5px] leading-[1.5] text-ink-faint">
                Your order is created once — retrying won&apos;t double-charge you.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
