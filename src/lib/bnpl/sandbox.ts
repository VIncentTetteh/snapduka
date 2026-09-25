import "server-only";

import { verifyHmacHeader } from "@/lib/couriers/adapters/shared";
import { BnplProviderError, type BnplOutcome, type BnplProvider } from "@/lib/bnpl/provider";

/**
 * A fake BNPL partner for local development, staging and tests.
 *
 * initialize sends the buyer straight back to the order page (payment
 * pending); the partner's decision then arrives as a signed webhook to
 * /api/payments/bnpl/webhook/sandbox — HMAC-SHA256 of the raw body in
 * `x-bnpl-sandbox-signature`, secret BNPL_SANDBOX_WEBHOOK_SECRET. That is how
 * QA scripts an approval (which captures the order) or a decline.
 *
 * Off unless BNPL_SANDBOX_ENABLED=true: an "approved" webhook marks an order
 * paid, so a sandbox reachable in production would be a free-goods button.
 */

export const BNPL_SANDBOX_ID = "sandbox";
export const BNPL_SANDBOX_SIGNATURE_HEADER = "x-bnpl-sandbox-signature";

const REFERENCE = /^[A-Za-z0-9_-]{6,64}$/;
const EVENT_ID = /^[A-Za-z0-9_.:-]{4,120}$/;

function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function createSandboxBnplProvider(options: { enabled: boolean; webhookSecret?: string }): BnplProvider {
  const guard = () => {
    if (!options.enabled) throw new BnplProviderError("not_configured", "The BNPL sandbox is off.");
  };

  return {
    id: BNPL_SANDBOX_ID,
    label: "Pay in 4",
    currencies: ["GHS", "NGN"],
    status: () => (options.enabled ? "ready" : "not_configured"),

    async initialize(input) {
      guard();
      return { authorizationUrl: input.callbackUrl, accessCode: `sbxbnpl_${input.reference}`, reference: input.reference };
    },

    async verify(reference) {
      guard();
      // The sandbox only answers by webhook. "pending" is never captured.
      return { status: "pending", amountMinor: 0, currency: "", reference, authorizationCode: null, customerCode: null };
    },

    // Deterministic, like the rest of the sandbox: the refund is processed at
    // once, so the ledger clawback path can be exercised end to end.
    async refund(input) {
      guard();
      return { providerId: `sbxrf_${input.reference}`, status: "processed" };
    },

    async verifyWebhook(request) {
      if (!options.enabled) return false;
      return verifyHmacHeader(options.webhookSecret, request.rawBody, request.headers[BNPL_SANDBOX_SIGNATURE_HEADER]);
    },

    /** Body: `{ "outcomes": [{ reference, eventId, status, amountMinor, currency, feeMinor? }] }`. */
    parseWebhook(request) {
      let body: unknown;
      try {
        body = JSON.parse(request.rawBody);
      } catch {
        return [];
      }
      const raw =
        body && typeof body === "object" && Array.isArray((body as { outcomes?: unknown }).outcomes)
          ? (body as { outcomes: Record<string, unknown>[] }).outcomes
          : [];
      const outcomes: BnplOutcome[] = [];
      for (const item of raw) {
        const amount = nonNegativeInt(item.amountMinor);
        if (
          typeof item.reference !== "string" ||
          !REFERENCE.test(item.reference) ||
          typeof item.eventId !== "string" ||
          !EVENT_ID.test(item.eventId) ||
          (item.status !== "approved" && item.status !== "declined") ||
          amount === null ||
          (item.currency !== "GHS" && item.currency !== "NGN")
        ) {
          continue;
        }
        outcomes.push({
          reference: item.reference,
          eventId: item.eventId,
          status: item.status,
          amountMinor: amount,
          currency: item.currency,
          feeMinor: nonNegativeInt(item.feeMinor) ?? 0,
        });
      }
      return outcomes;
    },
  };
}
