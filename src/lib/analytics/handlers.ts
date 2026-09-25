import "server-only";

import { onDomainEvent, type DomainEvent } from "@/lib/events/handlers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Outbox handlers that turn domain events into analytics_events funnel rows.
 * Registered from src/lib/events/register.ts.
 *
 * Idempotent: record_order_analytics_event derives the event id from (type,
 * order), so the outbox's at-least-once delivery — including a retry caused by
 * a *different* handler for the same event failing — records one row.
 */

const DELIVERY_METHODS = new Set(["buyer_code", "rider_code", "buyer_tap", "operator", "auto"]);

function deliveryMethod(event: DomainEvent): string | null {
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const method = payload.method;
  // Only a known enum value goes into dimensions; the payload is not ours to
  // copy wholesale into a table sellers read.
  return typeof method === "string" && DELIVERY_METHODS.has(method) ? method : null;
}

/** protect.delivered → delivery_confirmed, with how it was confirmed. */
export async function recordDeliveryConfirmed(event: DomainEvent): Promise<void> {
  const method = deliveryMethod(event);
  const { error } = await createAdminClient().rpc("record_order_analytics_event", {
    p_event_type: "delivery_confirmed",
    p_order_id: event.aggregate_id,
    p_dimensions: method ? { method } : {},
  });
  // Rethrown so the outbox retries; a missing order (P0002) will not get
  // better, but claim_domain_events gives up after 10 attempts.
  if (error) throw new Error(`record_order_analytics_event(delivery_confirmed) failed: ${error.message}`);
}

export function registerAnalyticsHandlers(): void {
  onDomainEvent("protect.delivered", recordDeliveryConfirmed);
}

registerAnalyticsHandlers();
