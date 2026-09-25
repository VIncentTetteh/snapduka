import "server-only";

import { randomUUID } from "node:crypto";

import type { CurrencyCode } from "@snapduka/core";

import { verifyHmacHeader } from "@/lib/couriers/adapters/shared";
import {
  FinancingPartnerError,
  type FinancingPartner,
  type FinancingPartnerEvent,
} from "@/lib/financing/partner";

/**
 * A fake lending partner for local development, staging and tests.
 *
 * requestDisbursement answers FINANCING_SANDBOX_AUTO_DECISION: `funded` (the
 * default: money "sent" immediately), `pending` (the answer arrives by
 * webhook) or `declined`. sendRepayment always succeeds. Webhooks are
 * HMAC-SHA256 of the raw body in `x-financing-sandbox-signature`, secret
 * FINANCING_SANDBOX_WEBHOOK_SECRET — how tests and QA script a funding,
 * decline or default.
 *
 * Off unless FINANCING_SANDBOX_ENABLED=true. A sandbox that says "funded"
 * reachable in production would credit sellers with money no partner sent.
 */

export const FINANCING_SANDBOX_ID = "sandbox";
export const FINANCING_SANDBOX_SIGNATURE_HEADER = "x-financing-sandbox-signature";

const CURRENCIES: readonly CurrencyCode[] = ["GHS", "NGN", "XOF"];

function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export function createSandboxFinancingPartner(options: {
  enabled: boolean;
  webhookSecret?: string;
  autoDecision?: string;
}): FinancingPartner {
  const guard = () => {
    if (!options.enabled) throw new FinancingPartnerError("not_configured", "The financing sandbox is off.");
  };

  return {
    id: FINANCING_SANDBOX_ID,
    status: () => (options.enabled ? "ready" : "not_configured"),

    async requestDisbursement(request) {
      guard();
      const decision = options.autoDecision ?? "funded";
      if (decision === "declined") return { status: "declined", reason: "Sandbox: declined by partner" };
      const partnerReference = `SBXFIN-${request.advanceId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
      return decision === "pending" ? { status: "pending", partnerReference } : { status: "funded", partnerReference };
    },

    async sendRepayment(transfer) {
      guard();
      return { status: "sent", partnerReference: `SBXREP-${transfer.reference}` };
    },

    async verifyWebhook(request) {
      if (!options.enabled) return false;
      return verifyHmacHeader(
        options.webhookSecret,
        request.rawBody,
        request.headers[FINANCING_SANDBOX_SIGNATURE_HEADER],
      );
    },

    /**
     * Body: `{ "events": [{ type, advanceId?, partnerReference?, reason?,
     * currency?, amountMinor?, reference? }] }`.
     */
    parseWebhook(request) {
      let body: unknown;
      try {
        body = JSON.parse(request.rawBody);
      } catch {
        return [];
      }
      const raw =
        body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events)
          ? (body as { events: Record<string, unknown>[] }).events
          : [];
      const events: FinancingPartnerEvent[] = [];
      for (const item of raw) {
        const advanceId = typeof item.advanceId === "string" && UUID.test(item.advanceId) ? item.advanceId : null;
        const reason = text(item.reason) ?? "No reason given";
        switch (item.type) {
          case "advance.funded": {
            const partnerReference = text(item.partnerReference, 120);
            if (advanceId && partnerReference) events.push({ type: item.type, advanceId, partnerReference });
            break;
          }
          case "advance.declined":
          case "advance.defaulted":
          case "advance.written_off":
            if (advanceId) events.push({ type: item.type, advanceId, reason });
            break;
          case "funding.settled": {
            const reference = text(item.reference, 120);
            const amount = item.amountMinor;
            if (
              reference &&
              isCurrencyCode(item.currency) &&
              typeof amount === "number" &&
              Number.isSafeInteger(amount) &&
              amount > 0
            ) {
              events.push({ type: item.type, currency: item.currency, amountMinor: amount, reference });
            }
            break;
          }
          default:
            break;
        }
      }
      return events;
    },
  };
}
