"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { canTransitionOrder, type OrderState } from "@/lib/commerce/transitions";
import { createAdminClient } from "@/lib/supabase/admin";

export async function updateOrderAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !["pending","active"].includes(actor.status)) return;
  const orderId = String(formData.get("orderId") ?? "");
  const next = String(formData.get("status") ?? "") as OrderState;
  const version = Number(formData.get("version"));
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id,status,event_version,payment_status")
    .eq("id", orderId).eq("seller_account_id", actor.sellerAccountId).maybeSingle();
  if (!order || order.event_version !== version || !canTransitionOrder(order.status, next)) return;
  if (next === "completed" && order.payment_status === "offline_due" && formData.get("offlinePaid") !== "yes") return;
  const updates: Record<string, unknown> = { status: next, event_version: version + 1 };
  if (next === "confirmed") updates.fulfillment_status = "confirmed";
  if (next === "processing") updates.fulfillment_status = "preparing";
  if (next === "completed") {
    updates.fulfillment_status = "fulfilled";
    if (order.payment_status === "offline_due") updates.payment_status = "paid";
  }
  if (next === "cancelled") updates.fulfillment_status = "cancelled";
  const { data: changed } = await admin.from("orders").update(updates).eq("id", orderId).eq("event_version", version).select("id").maybeSingle();
  if (!changed) return;
  await admin.from("order_events").insert({ order_id: orderId, seller_account_id: actor.sellerAccountId, event_type: `order_${next}`, actor_type: "seller", actor_id: actor.sellerAccountId, data: { from: order.status, to: next } });
  await admin.rpc("enqueue_order_notification", { p_order_id: orderId, p_event: next });
  revalidatePath("/dashboard"); revalidatePath("/dashboard/orders"); revalidatePath(`/dashboard/orders/${orderId}`);
}
