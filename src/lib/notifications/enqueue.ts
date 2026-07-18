import type { createAdminClient } from "@/lib/supabase/admin";

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
