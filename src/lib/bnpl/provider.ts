import "server-only";

import type { CurrencyCode } from "@snapduka/core";

import type { PaymentProvider } from "@/lib/payments/types";

/**
 * Buy now, pay later at checkout: the buyer pays a BNPL partner in
 * instalments, and the partner pays SnapDuka the full order amount up front.
 *
 * To SnapDuka it is therefore just another payment provider (ADR-0014): it
 * implements PaymentProvider so the checkout router can treat it like
 * Paystack, and a partner "approved and paid" becomes an ordinary capture
 * through apply_paystack_success -> capture_order_settlement — the same
 * settlement, Protect and ledger path every card and MoMo payment takes. The
 * buyer's instalment debt is the partner's, never SnapDuka's or the seller's.
 *
 * No partner is contracted yet: the registry answers the sandbox (dev/QA) or
 * not_configured, and an unconfigured BNPL provider is never offered.
 */

/** The partner's final answer on one checkout, delivered by webhook. */
export type BnplOutcome = {
  /** Our payment_attempts.reference, echoed back by the partner. */
  reference: string;
  /** The partner's own event id; the capture dedupes on it. */
  eventId: string;
  status: "approved" | "declined";
  /** What the partner paid SnapDuka for this order (full order total). */
  amountMinor: number;
  currency: CurrencyCode;
  /** The partner's merchant discount, borne by SnapDuka like a PSP fee. */
  feeMinor: number;
};

export type BnplWebhookRequest = {
  rawBody: string;
  headers: Readonly<Record<string, string>>;
};

export interface BnplProvider extends PaymentProvider {
  readonly id: string;
  /** Shown to the buyer, e.g. "Pay in 4". */
  readonly label: string;
  readonly currencies: readonly CurrencyCode[];
  status(): "ready" | "not_configured";
  /** Constant-time; false on any doubt. Never throws. */
  verifyWebhook(request: BnplWebhookRequest): Promise<boolean>;
  /** Only called after verifyWebhook passed. */
  parseWebhook(request: BnplWebhookRequest): BnplOutcome[];
}

export class BnplProviderError extends Error {
  readonly code: "not_configured" | "unsupported" | "unavailable";

  constructor(code: BnplProviderError["code"], message: string) {
    super(message);
    this.name = "BnplProviderError";
    this.code = code;
  }
}

function notConfigured(): never {
  throw new BnplProviderError("not_configured", "Pay later is not available.");
}

export const notConfiguredBnplProvider: BnplProvider = {
  id: "not_configured",
  label: "Pay later",
  currencies: [],
  status: () => "not_configured",
  initialize: async () => notConfigured(),
  verify: async () => notConfigured(),
  refund: async () => notConfigured(),
  verifyWebhook: async () => false,
  parseWebhook: () => [],
};
