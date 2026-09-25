import "server-only";

import type { CountryCode, CurrencyCode } from "@snapduka/core";

import { createSandboxFinancingPartner } from "@/lib/financing/partners/sandbox";

/**
 * The contract a licensed lending partner's integration implements.
 *
 * SnapDuka does not lend (ADR-0014): the partner underwrites the final
 * decision, funds each advance and is repaid from the sweep. No partner is
 * contracted yet, so this is shaped around what any revenue-based-financing
 * API has to do rather than one vendor's:
 *
 *   1. requestDisbursement: SnapDuka asks the partner to fund an accepted
 *      advance. The partner answers funded (money sent), pending (it will say
 *      by webhook) or declined (its own credit check said no).
 *   2. sendRepayment: SnapDuka pays what it has swept and remitted for the
 *      partner, as one transfer per run.
 *   3. Webhooks carry the asynchronous answers: funded, declined, and the
 *      partner declaring an advance defaulted or written off.
 *
 * The partner sees an advance id and amounts, never the seller's sales data:
 * SnapDuka's eligibility inputs stay in SnapDuka.
 */

export type DisbursementRequest = {
  advanceId: string;
  sellerAccountId: string;
  country: CountryCode;
  currency: CurrencyCode;
  principalMinor: number;
  feeMinor: number;
  totalRepayableMinor: number;
};

export type DisbursementResult =
  | { status: "funded"; partnerReference: string }
  | { status: "pending"; partnerReference: string }
  | { status: "declined"; reason: string };

export type RepaymentTransfer = {
  currency: CurrencyCode;
  amountMinor: number;
  /** Stable per run; the partner dedupes on it. */
  reference: string;
};

export type RepaymentResult = { status: "sent"; partnerReference: string } | { status: "failed"; reason: string };

export type FinancingPartnerEvent =
  | { type: "advance.funded"; advanceId: string; partnerReference: string }
  | { type: "advance.declined"; advanceId: string; reason: string }
  | { type: "advance.defaulted" | "advance.written_off"; advanceId: string; reason: string }
  /** The partner's cash for one or more disbursements has landed in SnapDuka's bank. */
  | { type: "funding.settled"; currency: CurrencyCode; amountMinor: number; reference: string };

export type FinancingWebhookRequest = {
  rawBody: string;
  headers: Readonly<Record<string, string>>;
};

export interface FinancingPartner {
  readonly id: string;
  status(): "ready" | "not_configured";
  requestDisbursement(request: DisbursementRequest): Promise<DisbursementResult>;
  sendRepayment(transfer: RepaymentTransfer): Promise<RepaymentResult>;
  /** Constant-time; false on any doubt. Never throws. */
  verifyWebhook(request: FinancingWebhookRequest): Promise<boolean>;
  /** Only called after verifyWebhook passed. Unknown shapes are dropped. */
  parseWebhook(request: FinancingWebhookRequest): FinancingPartnerEvent[];
}

export class FinancingPartnerError extends Error {
  readonly code: "not_configured" | "unavailable" | "rejected";

  constructor(code: FinancingPartnerError["code"], message: string) {
    super(message);
    this.name = "FinancingPartnerError";
    this.code = code;
  }
}

/**
 * The default until a partner is contracted. Nothing can be funded, so the
 * Capital page shows eligibility but no accept button, and an advance can never
 * reach the ledger through this path.
 */
export const notConfiguredFinancingPartner: FinancingPartner = {
  id: "not_configured",
  status: () => "not_configured",
  requestDisbursement: async () => {
    throw new FinancingPartnerError("not_configured", "Financing is not available yet.");
  },
  sendRepayment: async () => {
    throw new FinancingPartnerError("not_configured", "Financing is not available yet.");
  },
  verifyWebhook: async () => false,
  parseWebhook: () => [],
};

let cache: Map<string, FinancingPartner> | null = null;

function build(): Map<string, FinancingPartner> {
  const partners: FinancingPartner[] = [
    createSandboxFinancingPartner({
      enabled: process.env.FINANCING_SANDBOX_ENABLED === "true",
      webhookSecret: process.env.FINANCING_SANDBOX_WEBHOOK_SECRET,
      autoDecision: process.env.FINANCING_SANDBOX_AUTO_DECISION,
    }),
  ];
  return new Map(partners.map((partner) => [partner.id, partner]));
}

/** Test seam. */
export function setFinancingPartnersForTests(list: FinancingPartner[] | null): void {
  cache = list ? new Map(list.map((partner) => [partner.id, partner])) : null;
}

/**
 * The partner a market's policy names (financing_policies.partner), or
 * not_configured when it is unknown or not ready. Webhooks use the same lookup
 * by the id in their URL.
 */
export function getFinancingPartner(id: string | null | undefined): FinancingPartner {
  cache ??= build();
  const partner = cache.get(id ?? "");
  return partner && partner.status() === "ready" ? partner : notConfiguredFinancingPartner;
}
