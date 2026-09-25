import "server-only";

import { onDomainEvent, type DomainEvent } from "@/lib/events/handlers";
import type { Json } from "@snapduka/core";

import type { SellerFinanceEvent } from "@/lib/notifications/templates";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Tells a seller when their SnapDuka Capital advance arrives and when it is
 * repaid. The financing SQL (202609250221) emits the events; nothing handled
 * them, so the first a seller heard of their advance was an unexplained jump
 * in their balance. Idempotent: each event queues at most one message per
 * channel, keyed by the outbox event id.
 */

const EVENT_TEMPLATE: Record<string, SellerFinanceEvent> = {
  "financing.disbursed": "financing_disbursed",
  "financing.repaid": "financing_repaid",
};

export async function notifySellerOfFinancing(event: DomainEvent): Promise<void> {
  const template = EVENT_TEMPLATE[event.event_type];
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  const sellerAccountId = typeof payload.sellerAccountId === "string" ? payload.sellerAccountId : null;
  if (!template || !sellerAccountId) return;

  const admin = createAdminClient();
  const dedupeKey = `financing:${event.id}`;
  const { data: existing } = await admin
    .from("notifications")
    .select("id")
    .eq("template", template)
    .eq("payload->>dedupeKey", dedupeKey)
    .limit(1);
  if (existing && existing.length > 0) return;

  const { data: seller } = await admin
    .from("seller_accounts")
    .select("contact_email")
    .eq("id", sellerAccountId)
    .maybeSingle();

  const body: { [key: string]: Json } = {
    dedupeKey,
    advanceId: typeof payload.advanceId === "string" ? payload.advanceId : null,
    amountMinor: typeof payload.principalMinor === "number" ? payload.principalMinor : null,
    currency: typeof payload.currency === "string" ? payload.currency : null,
  };
  const rows = [
    { seller_account_id: sellerAccountId, channel: "in_app", recipient: sellerAccountId, template, payload: body },
    ...(seller?.contact_email
      ? [{ seller_account_id: sellerAccountId, channel: "email", recipient: seller.contact_email, template, payload: body }]
      : []),
  ];
  const { error } = await admin.from("notifications").insert(rows);
  if (error) throw new Error(`could not queue ${template} for ${sellerAccountId}: ${error.message}`);
}

onDomainEvent("financing.disbursed", notifySellerOfFinancing);
onDomainEvent("financing.repaid", notifySellerOfFinancing);
