import type { CurrencyCode } from "@/lib/countries/types";

/**
 * Buyers see the symbol they use locally, not the ISO code. `formatMoney` in
 * @/lib/i18n stays the seller-facing formatter — dashboards and invoices read
 * better with unambiguous ISO codes.
 */
const SYMBOL: Record<CurrencyCode, string> = { GHS: "GH₵", NGN: "₦", XOF: "CFA" };

/**
 * Single storefront price renderer. Every buyer-facing surface — grid, product
 * page, variant chips, checkout — must use this: shoppers were previously shown
 * "GH₵ 240" and "GHS 240.00" for the same product on the same screen.
 *
 * Pesewas and kobo only appear when an amount actually carries them, so whole
 * prices stay clean while totals stay exact. XOF has no minor unit at all.
 */
export function formatPrice(minor: number, currency: CurrencyCode): string {
  const symbol = SYMBOL[currency] ?? currency;
  if (currency === "XOF") return `${symbol} ${minor.toLocaleString("en-US")}`;
  const major = minor / 100;
  return `${symbol} ${major.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
