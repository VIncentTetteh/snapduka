"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { canTransitionOrder, type OrderState } from "@/lib/commerce/transitions";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueIntegrationEvent } from "@/lib/integrations/events";

export async function updateOrderAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner","orders.manage") || !["pending","active"].includes(actor.status)) return;
  const orderId = String(formData.get("orderId") ?? "");
  const next = String(formData.get("status") ?? "") as OrderState;
  const version = Number(formData.get("version"));
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id,status,event_version,payment_status,customer_id,public_reference,total_minor,currency")
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
  if (next === "completed") await admin.rpc("finalize_order_stock", { p_order_id: orderId, p_outcome: "consumed" });
  if (next === "cancelled") await admin.rpc("finalize_order_stock", { p_order_id: orderId, p_outcome: "released" });
  await admin.from("order_events").insert({ order_id: orderId, seller_account_id: actor.sellerAccountId, event_type: `order_${next}`, actor_type: "seller", actor_id: actor.sellerAccountId, data: { from: order.status, to: next } });
  await admin.rpc("enqueue_order_notification", { p_order_id: orderId, p_event: next });
  if (next === "completed") await enqueueIntegrationEvent({ data: { currency: order.currency, customerId: order.customer_id, orderId, reference: order.public_reference, totalMinor: order.total_minor }, eventId: `${orderId}:${version + 1}:completed`, eventType: "order.completed", sellerAccountId: actor.sellerAccountId });
  revalidatePath("/dashboard"); revalidatePath("/dashboard/orders"); revalidatePath(`/dashboard/orders/${orderId}`);
}

export async function bulkOrderStatusAction(formData: FormData) {
  const actor = await resolveServerActor();
  const ids = formData.getAll("orderIds").map(String).slice(0, 100);
  const next = String(formData.get("status")) as OrderState;
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner","orders.manage") || !["pending","active"].includes(actor.status) || !ids.length || !["confirmed","processing","completed","cancelled"].includes(next)) return;
  const admin = createAdminClient();
  const { data: orders } = await admin.from("orders").select("id,status,event_version,payment_status").eq("seller_account_id", actor.sellerAccountId).in("id", ids);
  for (const order of orders ?? []) {
    if (!canTransitionOrder(order.status, next) || (next === "completed" && order.payment_status === "offline_due")) continue;
    const { data: changed } = await admin.from("orders").update({ status: next, event_version: order.event_version + 1 }).eq("id", order.id).eq("event_version", order.event_version).select("id").maybeSingle();
    if (!changed) continue;
    if (next === "completed") await admin.rpc("finalize_order_stock", { p_order_id: order.id, p_outcome: "consumed" });
    if (next === "cancelled") await admin.rpc("finalize_order_stock", { p_order_id: order.id, p_outcome: "released" });
  }
  revalidatePath("/dashboard/orders");
}
