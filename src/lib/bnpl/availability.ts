import "server-only";

import type { CountryCode, CurrencyCode } from "@snapduka/core";

import { getActiveBnplProvider } from "@/lib/bnpl/registry";
import { routeCheckout } from "@/lib/payments/providers/router";
import { settlementModeFor } from "@/lib/protect/service";

export type BnplCheckoutOption = { label: string };

/**
 * Whether checkout should offer "pay in instalments" for this shop: the same
 * conditions /api/payments/bnpl/initialize enforces (flag, configured partner,
 * healthy circuit, ledger settlement, supported currency), so the option is
 * never shown only to fail on click. Fails closed: any lookup error hides it.
 */
export async function bnplCheckoutOption(input: {
  sellerAccountId: string;
  country: CountryCode;
  currency: CurrencyCode;
}): Promise<BnplCheckoutOption | null> {
  if (input.currency !== "GHS" && input.currency !== "NGN") return null;
  try {
    if ((await settlementModeFor(input.sellerAccountId)) !== "ledger") return null;
    const routes = await routeCheckout({ ...input, method: "bnpl" });
    return routes.length > 0 ? { label: getActiveBnplProvider().label } : null;
  } catch (error) {
    console.error("[bnpl] availability check failed; not offering pay later", error);
    return null;
  }
}
