import { gradientForSeed } from "@/components/ui/gradient-placeholder";
import type { SponsoredListing } from "@/lib/ads/sponsored";
import { formatPrice } from "@/lib/storefront/price";

/**
 * The paid slot on /discover. Labelled "Sponsored" on the section AND on every
 * card: a buyer must never mistake a paid placement for an organic result.
 *
 * Plain anchors, not next/link: prefetching the click URL would look like a
 * click, and even though the click route drops prefetches, not firing them at
 * all is cheaper and keeps billing out of the navigation path.
 */
export function SponsoredListings({ listings }: { listings: SponsoredListing[] }) {
  if (listings.length === 0) return null;
  return (
    <section aria-labelledby="sponsored-heading" className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="sponsored-heading" className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Sponsored
        </h2>
        <p className="m-0 text-[12px] text-ink-faint">Paid placements from SnapDuka sellers</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((listing) => (
          <a
            className="group relative overflow-hidden rounded-2xl border border-line bg-white no-underline transition-shadow hover:shadow-card"
            href={listing.href}
            key={listing.campaignId}
            rel="sponsored"
          >
            {listing.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- storage URL, sized by CSS
              <img alt="" className="block h-32 w-full object-cover" loading="lazy" src={listing.imageUrl} />
            ) : (
              <span
                aria-hidden="true"
                className="block h-32"
                style={{ background: gradientForSeed(listing.productId) }}
              />
            )}
            <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
              Sponsored
            </span>
            <div className="p-4">
              <h3 className="m-0 line-clamp-1 font-serif text-[17px] font-medium text-ink">{listing.productName}</h3>
              <p className="m-0 mt-1 text-[13px] font-semibold text-accent">
                {formatPrice(listing.priceMinor, listing.currency)} · {listing.shopName}
              </p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
