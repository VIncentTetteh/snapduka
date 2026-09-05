"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { isSellerTransition } from "@/lib/commerce/transitions";
import {
  bulkTransitionOrders,
  transitionOrder,
  type TransitionFailure,
} from "@/lib/orders/transition";

// Thin adapters: FormData in, revalidation out. Every rule about what a
// transition does lives in @/lib/orders/transition, which the mobile API route
// calls too — so the phone and the dashboard cannot drift.

/**
 * Why each refusal is spoken.
 *
 * Every branch below used to `return` in silence, and the version conflict is
 * the one that bites in normal use: two tabs, or a page left open while the
 * order moved on, and "Mark complete" does nothing at all. No change, no error,
 * no hint to reload — indistinguishable from a broken button, and the seller's
 * natural response is to press it again.
 */
const FAILURE_MESSAGE: Record<TransitionFailure, string> = {
  not_found: "That order could not be found.",
  version_conflict:
    "This order changed while you had it open. Reload the page to see where it is now.",
  illegal_transition: "That order cannot move to this status from where it is now.",
  offline_unconfirmed: "Tick “Payment received” before completing a cash order.",
};

function canManageOrders(actor: Awaited<ReturnType<typeof resolveServerActor>>) {
  return (
    actor.kind === "seller" &&
    hasPermission(actor.role ?? "owner", "orders.manage") &&
    ["pending", "active"].includes(actor.status)
  );
}

export async function updateOrderAction(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  const fail: (message: string) => never = (message) => {
    const path = orderId ? `/dashboard/orders/${orderId}` : "/dashboard/orders";
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  };

  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to update orders.");
  if (!canManageOrders(actor)) fail("Your role does not allow updating orders.");
  if (actor.kind !== "seller") return;

  const next = String(formData.get("status") ?? "");
  const expectedVersion = Number(formData.get("version"));
  if (!isSellerTransition(next) || !Number.isInteger(expectedVersion)) {
    fail("That status change is not valid.");
  }

  const result = await transitionOrder({
    sellerAccountId: actor.sellerAccountId,
    orderId,
    next,
    expectedVersion,
    offlinePaidConfirmed: formData.get("offlinePaid") === "yes",
  });
  if (!result.ok) fail(FAILURE_MESSAGE[result.reason]);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${orderId}`);
}

export async function bulkOrderStatusAction(formData: FormData) {
  const fail: (message: string) => never = (message) =>
    redirect(`/dashboard/orders?error=${encodeURIComponent(message)}`);

  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to update orders.");
  if (!canManageOrders(actor)) fail("Your role does not allow updating orders.");
  if (actor.kind !== "seller") return;

  const orderIds = formData.getAll("orderIds").map(String);
  const next = String(formData.get("status") ?? "");
  if (!orderIds.length) fail("Select at least one order first.");
  if (!isSellerTransition(next)) fail("That status change is not valid.");

  const outcomes = await bulkTransitionOrders({
    sellerAccountId: actor.sellerAccountId,
    orderIds,
    next,
  });

  revalidatePath("/dashboard/orders");

  // A bulk run partly succeeding is the normal case when one order moved
  // underneath the seller, so say how many did not rather than reporting the
  // whole batch as done.
  const failed = outcomes.filter((entry) => !entry.result.ok).length;
  if (failed > 0) {
    fail(
      failed === outcomes.length
        ? "None of those orders could be updated. Reload the page to see where they are now."
        : `${failed} of ${outcomes.length} orders could not be updated. Reload the page to see where they are now.`,
    );
  }
}
