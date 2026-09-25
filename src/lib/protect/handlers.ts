import "server-only";

import { onDomainEvent, type DomainEvent } from "@/lib/events/handlers";
import { startRefund } from "@/lib/payments/refunds";
import { sendSms } from "@/lib/notifications/sms";
import { sendDeliveryCodeWhatsApp } from "@/lib/notifications/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Outbox handlers for SnapDuka Protect. Each is idempotent: the outbox delivers
 * at least once.
 */

type Payload = Record<string, unknown>;

function payloadOf(event: DomainEvent): Payload {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? (event.payload as Payload)
    : {};
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://snapduka.shop").replace(/\/$/, "");
}

/**
 * The buyer's delivery code goes to the BUYER's phone from the order snapshot,
 * never the seller's. The plaintext is then removed from the outbox row.
 *
 * With no SMS provider configured the code is still redacted: the buyer can
 * always get a fresh one from their tracking page, which rotates it and shows
 * it only to the tracking-token holder. A provider *error* is rethrown so the
 * outbox retries while the code is still available to send.
 */
export async function deliverCode(event: DomainEvent): Promise<void> {
  const payload = payloadOf(event);
  const code = typeof payload.code === "string" ? payload.code : null;
  if (!code) return; // already delivered and redacted on an earlier attempt

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("public_reference,tracking_token,buyer_snapshot,seller_account_id")
    .eq("id", event.aggregate_id)
    .maybeSingle();

  const phone =
    order && typeof order.buyer_snapshot === "object" && order.buyer_snapshot !== null
      ? (order.buyer_snapshot as Payload).phone
      : null;

  if (order && typeof phone === "string" && phone) {
    // WhatsApp first (the delivery_code template), SMS when WhatsApp is not
    // configured or fails for a reason retrying will not fix. A transient
    // WhatsApp error throws, so the outbox retries while the code still exists.
    const whatsapp = await sendDeliveryCodeWhatsApp({
      buyerPhone: phone,
      code,
      reference: order.public_reference,
      sellerAccountId: order.seller_account_id,
    });
    if (!whatsapp.delivered) {
      const text =
        `SnapDuka Protect: your delivery code for order ${order.public_reference} is ${code}. ` +
        `Give it to the rider ONLY when you have your order. ` +
        `Track: ${appUrl()}/orders/${order.tracking_token}`;
      const result = await sendSms(phone, text);
      if (!result.delivered) {
        console.warn(
          `[protect] delivery code for ${event.aggregate_id} not sent (whatsapp: ${whatsapp.reason}, sms: ${result.reason})`,
        );
      }
    }
  }

  const { error } = await admin.rpc("redact_domain_event_keys", { p_id: event.id, p_keys: ["code"] });
  if (error) throw new Error(`could not redact delivery code: ${error.message}`);
}

/** An operator found for the buyer: return the money through Paystack. */
export async function refundAfterDispute(event: DomainEvent): Promise<void> {
  const result = await startRefund({ orderId: event.aggregate_id });
  // Already fully refunded or in flight means an earlier attempt succeeded.
  if (result.ok || result.reason === "fully_refunded" || result.reason === "in_flight") return;
  throw new Error(`Protect refund for ${event.aggregate_id} failed: ${result.reason}`);
}

/** Fan a Protect milestone out to buyer and seller through the notification outbox. */
export function notifyOrder(eventName: string) {
  return async (event: DomainEvent): Promise<void> => {
    const { error } = await createAdminClient().rpc("enqueue_order_notification", {
      p_order_id: event.aggregate_id,
      p_event: eventName,
    });
    if (error) throw new Error(`enqueue_order_notification(${eventName}) failed: ${error.message}`);
  };
}

export function registerProtectHandlers(): void {
  onDomainEvent("protect.code_issued", deliverCode);
  onDomainEvent("protect.refund_requested", refundAfterDispute);
  onDomainEvent("protect.held", notifyOrder("protect_held"));
  onDomainEvent("protect.delivered", notifyOrder("protect_delivered"));
  onDomainEvent("protect.released", notifyOrder("protect_released"));
  onDomainEvent("protect.disputed", notifyOrder("protect_disputed"));
  onDomainEvent("protect.dispute_resolved", notifyOrder("protect_dispute_resolved"));
  onDomainEvent("protect.dispatch_overdue", notifyOrder("protect_dispatch_overdue"));
  onDomainEvent("protect.unheld", notifyOrder("protect_unheld"));
  onDomainEvent("chargeback.opened", notifyOrder("chargeback_opened"));
  onDomainEvent("chargeback.resolved", notifyOrder("chargeback_resolved"));
}

registerProtectHandlers();
