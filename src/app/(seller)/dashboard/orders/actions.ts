"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { isSellerTransition } from "@/lib/commerce/transitions";
import { bulkTransitionOrders, transitionOrder } from "@/lib/orders/transition";

// Thin adapters: FormData in, revalidation out. Every rule about what a
// transition does lives in @/lib/orders/transition, which the mobile API route
// calls too — so the phone and the dashboard cannot drift.

function canManageOrders(actor: Awaited<ReturnType<typeof resolveServerActor>>) {
  return (
    actor.kind === "seller" &&
    hasPermission(actor.role ?? "owner", "orders.manage") &&
    ["pending", "active"].includes(actor.status)
  );
}

export async function updateOrderAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (!canManageOrders(actor) || actor.kind !== "seller") return;

  const orderId = String(formData.get("orderId") ?? "");
  const next = String(formData.get("status") ?? "");
  const expectedVersion = Number(formData.get("version"));
  if (!isSellerTransition(next) || !Number.isInteger(expectedVersion)) return;

  const result = await transitionOrder({
    sellerAccountId: actor.sellerAccountId,
    orderId,
    next,
    expectedVersion,
    offlinePaidConfirmed: formData.get("offlinePaid") === "yes",
  });
  if (!result.ok) return;

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${orderId}`);
}

export async function bulkOrderStatusAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (!canManageOrders(actor) || actor.kind !== "seller") return;

  const orderIds = formData.getAll("orderIds").map(String);
  const next = String(formData.get("status") ?? "");
  if (!orderIds.length || !isSellerTransition(next)) return;

  await bulkTransitionOrders({
    sellerAccountId: actor.sellerAccountId,
    orderIds,
    next,
  });

  revalidatePath("/dashboard/orders");
}
