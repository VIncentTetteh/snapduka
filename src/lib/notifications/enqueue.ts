import type { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/countries/types";
import type { CreatorNotificationEvent } from "@/lib/notifications/templates";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Enqueues order-event notifications exactly once per (order, event) — the
 * SQL function fans out to buyer/seller channels per preferences, and this
 * guard keeps idempotent retries (checkout replays, webhook + verify races)
 * from double-notifying.
 */
export async function enqueueOrderEventNotification(
  admin: AdminClient,
  orderId: string,
  event: string,
): Promise<void> {
  const { data: existing } = await admin
    .from("notifications")
    .select("id")
    .eq("order_id", orderId)
    .contains("payload", { status: event })
    .limit(1)
    .maybeSingle();
  if (existing) return;
  await admin.rpc("enqueue_order_notification", { p_order_id: orderId, p_event: event });
}

/**
 * Tells a creator something happened.
 *
 * The creator programme sent no notifications at all: not on an accepted
 * partnership, not on a commission, not on a payment — while
 * `markCommissionsPaid` told the seller "the creator has been notified". A
 * creator learned that money had moved only by opening the portal on spec.
 *
 * The rules themselves — only an active creator, email when there is one and SMS
 * otherwise, never the same event twice for the same thing — live in
 * `enqueue_creator_notification` rather than here, because the other two events
 * (a commission accruing, a commission maturing) fire from SQL with nobody
 * pressing a button, and two copies of "who may be messaged" would drift.
 *
 * The amount goes as minor units and a currency, not a formatted string: SQL
 * cannot reproduce `Intl.NumberFormat`, so the worker formats and both paths
 * render identically.
 */
export async function enqueueCreatorNotification(
  admin: AdminClient,
  input: {
    creatorId: string;
    sellerAccountId: string;
    event: CreatorNotificationEvent;
    shopName: string;
    amountMinor?: number;
    currency?: CurrencyCode;
    /** Deduplicates a repeat of the same event for the same thing. */
    dedupeKey?: string;
  },
): Promise<boolean> {
  const { data, error } = await admin.rpc("enqueue_creator_notification", {
    p_creator_id: input.creatorId,
    p_seller_account_id: input.sellerAccountId,
    p_event: input.event,
    p_shop_name: input.shopName,
    p_amount_minor: input.amountMinor ?? undefined,
    p_currency: input.currency ?? undefined,
    p_dedupe_key: input.dedupeKey ?? undefined,
  });

  // A creator not hearing about their money is bad; failing the seller's action
  // because of it would be worse.
  if (error) {
    console.error("[notifications] could not enqueue a creator notification", {
      event: input.event,
      creatorId: input.creatorId,
      error,
    });
    return false;
  }

  return data === true;
}
