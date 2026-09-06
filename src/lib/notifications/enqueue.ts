import type { createAdminClient } from "@/lib/supabase/admin";
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
 * Email when we have one, SMS otherwise. `creators.contact_phone` is NOT NULL
 * and `contact_email` is optional, so SMS is the channel that always exists —
 * the same order `inviteCreator` uses to deliver the invitation itself.
 *
 * `notifications.seller_account_id` is NOT NULL and carries the shop the message
 * is about, not the recipient: a creator has no seller account, and the column
 * is what scopes the row for the worker and for support.
 */
export async function enqueueCreatorNotification(
  admin: AdminClient,
  input: {
    creatorId: string;
    sellerAccountId: string;
    event: CreatorNotificationEvent;
    shopName: string;
    /** Pre-formatted in the creator's currency by the caller. */
    amount?: string;
    /** Deduplicates a repeat of the same event for the same thing. */
    dedupeKey?: string;
  },
): Promise<boolean> {
  const { data: creator } = await admin
    .from("creators")
    .select("contact_email,contact_phone,status")
    .eq("id", input.creatorId)
    .maybeSingle();
  // A suspended or closed creator is not messaged.
  if (!creator || creator.status !== "active") return false;

  if (input.dedupeKey) {
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("template", input.event)
      .contains("payload", { dedupeKey: input.dedupeKey })
      .limit(1)
      .maybeSingle();
    // Already sent for this exact thing; treat as delivered rather than
    // sending a second copy.
    if (existing) return true;
  }

  const channel = creator.contact_email ? "email" : "sms";
  const recipient = creator.contact_email ?? creator.contact_phone;

  const { error } = await admin.from("notifications").insert({
    seller_account_id: input.sellerAccountId,
    channel,
    recipient,
    template: input.event,
    payload: {
      event: input.event,
      shopName: input.shopName,
      ...(input.amount ? { amount: input.amount } : {}),
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    },
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

  return true;
}
