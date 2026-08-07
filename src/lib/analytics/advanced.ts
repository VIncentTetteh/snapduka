/**
 * Commerce metrics and per-product profit live in @snapduka/core so the seller
 * app reports the same numbers as the dashboard. The reasoning — in particular
 * why a missing cost yields null rather than zero — is documented there.
 *
 * This module remains the web-side import path.
 */
export {
  advancedCommerceMetrics,
  productProfitSummaries,
  type ProductProfitInput,
  type ProductProfitSummary,
} from "@snapduka/core";
