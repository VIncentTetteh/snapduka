import Link from "next/link";

import { CartButton } from "@/components/storefront/cart-button";
import { ShareButton } from "@/components/storefront/share-button";
import type { CountryCode } from "@/lib/countries/types";

const COUNTRY_LABEL: Record<CountryCode, string> = {
  GH: "Ghana",
  NG: "Nigeria",
  CI: "Côte d'Ivoire",
};

/**
 * Sticky storefront header: avatar, shop name, share and live cart buttons.
 * `backHref` renders the back chevron on inner pages.
 *
 * `verified` and `fulfillment` are both required to be passed explicitly rather
 * than defaulted. Both were previously hardcoded true/"Delivers nationwide" for
 * every shop, and a default here is exactly how that survives a refactor.
 */
export function StoreHeader({
  name,
  slug,
  country,
  canonicalUrl,
  verified,
  fulfillment,
  backHref,
  logoUrl = null,
  titleAsH1 = false,
  shareTitle,
  shareSubject = "store",
}: {
  name: string;
  slug: string;
  country: CountryCode;
  canonicalUrl: string;
  verified: boolean;
  fulfillment: string | null;
  backHref?: string;
  logoUrl?: string | null;
  titleAsH1?: boolean;
  /** What the share sheet announces. Defaults to the shop name. */
  shareTitle?: string;
  /** What the button says it shares, so a product page does not say "store". */
  shareSubject?: "store" | "product";
}) {
  const NameTag = titleAsH1 ? "h1" : "span";
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-[60px] max-w-[1040px] items-center gap-3 px-4">
        {backHref ? (
          <Link
            href={backHref}
            aria-label="Back"
            className="grid h-10 w-10 flex-none place-items-center rounded-[10px] border border-line-input bg-white text-ink transition-colors hover:bg-line-soft"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        ) : null}
        <Link href={`/${slug}`} className="flex min-h-10 min-w-0 items-center gap-2.5 text-left no-underline">
          {logoUrl ? (
            // Seller-uploaded shop logo
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              src={logoUrl}
              className="h-[34px] w-[34px] flex-none rounded-full border border-line bg-white object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="h-[34px] w-[34px] flex-none rounded-full bg-[linear-gradient(135deg,#D9C6A8,#A8875D)]"
            />
          )}
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[15px] font-bold text-ink">
              <NameTag className="m-0 max-w-none truncate font-sans text-[15px] font-bold leading-normal tracking-normal text-ink">
                {name}
              </NameTag>
              {verified ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" role="img" aria-label="Verified seller" className="flex-none">
                  <circle cx="7" cy="7" r="6.4" fill="#047857" />
                  <path d="M4.4 7.2 6.2 9l3.4-3.8" stroke="#FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </span>
            <span className="block truncate text-[11px] text-ink-muted">
              {[COUNTRY_LABEL[country] ?? country, fulfillment].filter(Boolean).join(" · ")}
            </span>
          </span>
        </Link>
        <div className="flex-1" />
        <ShareButton subject={shareSubject} title={shareTitle ?? name} url={canonicalUrl} />
        <CartButton slug={slug} />
      </div>
    </header>
  );
}
