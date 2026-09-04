import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AnalyticsTracker } from "@/components/storefront/analytics-tracker";
import { ProductGrid } from "@/components/storefront/product-grid";
import { StoreHeader } from "@/components/storefront/store-header";
import {
  getPublicCollections,
  getPublicProducts,
  getPublicShop,
  getReviewStats,
} from "@/lib/storefront/queries";
import { fulfillmentSummary } from "@/lib/storefront/fulfillment-summary";
import { appOrigin } from "@/lib/app-url";
import { normalizeToOne, publicMediaUrl } from "@/lib/storefront/media";
import { canonicalStorefrontUrl } from "@/lib/storefront/sharing";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; collection?: string; page?: string; campaign?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const shop = await getPublicShop(slug);
  if (!shop) return {};
  const url = canonicalStorefrontUrl(await appOrigin(), slug);
  return {
    title: `${shop.display_name} | SnapDuka`,
    description: `Shop ${shop.display_name} securely on SnapDuka.`,
    alternates: { canonical: url },
    openGraph: { title: shop.display_name, url, images: [`/${slug}/opengraph-image`] },
  };
}

export default async function StorefrontPage({ params, searchParams }: Props) {
  const [{ slug }, filters] = await Promise.all([params, searchParams]);
  const shop = await getPublicShop(slug);
  if (!shop) notFound();
  const canonicalUrl = canonicalStorefrontUrl(await appOrigin(), slug);

  const [products, collections] = await Promise.all([
    getPublicProducts(shop.id, {
      search: filters.q,
      collection: filters.collection,
      page: Number(filters.page || 1),
    }),
    getPublicCollections(shop.id),
  ]);

  // One query for the whole grid rather than one per card — 24 round trips to
  // draw star rows is what makes a catalogue feel slow on a phone.
  const reviewStats = await getReviewStats(products.map((product) => product.id));

  const collectionHref = (collectionSlug?: string) => {
    const qs = new URLSearchParams();
    if (filters.q) qs.set("q", filters.q);
    if (filters.campaign) qs.set("campaign", filters.campaign);
    if (collectionSlug) qs.set("collection", collectionSlug);
    const query = qs.toString();
    return `/${slug}${query ? `?${query}` : ""}`;
  };

  return (
    <main className="sd-main min-h-svh bg-paper text-ink">
      <AnalyticsTracker campaign={filters.campaign} country={shop.country} eventType="visit" shopId={shop.id} />
      <StoreHeader
        canonicalUrl={canonicalUrl}
        country={shop.country}
        fulfillment={fulfillmentSummary(shop.fulfillment_methods)}
        logoUrl={publicMediaUrl(normalizeToOne(shop.shop_branding)?.logo_path, "shop-logos")}
        name={shop.display_name}
        slug={slug}
        titleAsH1
        verified={Boolean(shop.verified_at)}
      />

      <div className="mx-auto max-w-[1040px] px-4 pb-16 pt-5">
        {/* Search */}
        <form role="search" className="relative mb-3.5">
          {filters.collection ? (
            <input name="collection" type="hidden" value={filters.collection} />
          ) : null}
          {filters.campaign ? (
            <input name="campaign" type="hidden" value={filters.campaign} />
          ) : null}
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
          >
            <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            aria-label="Search products"
            placeholder={`Search ${shop.display_name}…`}
            className="h-11 w-full rounded-xl border border-line-input bg-white pl-9.5 pr-3.5 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]"
          />
        </form>

        {/* Collection pills */}
        {collections.length > 0 ? (
          <div className="mb-4.5 flex gap-2 overflow-x-auto pb-1">
            <Link
              href={collectionHref()}
              aria-current={!filters.collection ? "page" : undefined}
              className={`flex h-10 flex-none items-center whitespace-nowrap rounded-full border px-4 text-[13px] font-semibold no-underline transition-colors ${
                !filters.collection
                  ? "border-ink bg-ink text-paper"
                  : "border-line-input bg-white text-ink-soft hover:border-[#B9AC98]"
              }`}
            >
              All
            </Link>
            {collections.map((collection) => {
              const active = filters.collection === collection.slug;
              return (
                <Link
                  key={collection.id}
                  href={collectionHref(collection.slug)}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-10 flex-none items-center whitespace-nowrap rounded-full border px-4 text-[13px] font-semibold no-underline transition-colors ${
                    active
                      ? "border-ink bg-ink text-paper"
                      : "border-line-input bg-white text-ink-soft hover:border-[#B9AC98]"
                  }`}
                >
                  {collection.name}
                </Link>
              );
            })}
          </div>
        ) : null}

        <ProductGrid
          campaign={filters.campaign}
          products={products}
          reviewStats={reviewStats}
          slug={slug}
        />

        <p className="mt-7 text-center text-[11.5px] text-ink-faint">
          Powered by SnapDuka · Guest checkout · Payment options shown at checkout
        </p>
      </div>
    </main>
  );
}
