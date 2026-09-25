"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { writeAuditEvent } from "@/lib/audit/write";
import { resolveServerActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Operator decisions that move money under SnapDuka Protect: resolving a
 * buyer's dispute, and writing off a seller debt SnapDuka cannot recover.
 * Both are recorded in audit_events; both refuse loudly rather than silently,
 * following resolveCaseAction.
 */

function back(path: string, message: string, ok = false): never {
  redirect(`${path}?${ok ? "saved" : "error"}=${encodeURIComponent(message)}`);
}

export async function resolveProtectDisputeAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/cases");

  const caseId = String(formData.get("caseId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const path = caseId ? `/admin/cases/${caseId}` : "/admin/cases";

  if (outcome !== "release" && outcome !== "refund") back(path, "Choose release or refund.");
  if (!note) back(path, "Write why before resolving — the buyer and seller both see the outcome.");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("resolve_protect_dispute", {
    p_order_id: orderId,
    p_outcome: outcome,
    p_note: note,
    p_operator_user_id: actor.userId,
  });
  if (error) back(path, `The dispute could not be resolved: ${error.message}`);
  if (data !== "resolved") back(path, data === "not_disputed" ? "This order is not in a Protect dispute." : "Order not found.");

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: `protect_dispute_${outcome}`,
    entityType: "order",
    entityId: orderId,
    before: { state: "disputed" },
    after: { outcome },
    metadata: { caseId, note },
  });

  revalidatePath(path);
  back(
    path,
    outcome === "refund" ? "Resolved for the buyer. The refund is being sent." : "Resolved for the seller.",
    true,
  );
}

export async function writeOffDebtAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/sellers");

  const sellerId = String(formData.get("sellerId") ?? "");
  const currency = String(formData.get("currency") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const amount = Number.parseFloat(String(formData.get("amount") ?? ""));
  const path = `/admin/sellers/${sellerId}`;

  if (!["GHS", "NGN", "XOF"].includes(currency)) back(path, "Choose a currency.");
  if (!Number.isFinite(amount) || amount <= 0) back(path, "Enter the amount to write off.");
  if (!reason) back(path, "Record why the debt is being written off.");
  const amountMinor = Math.round(currency === "XOF" ? amount : amount * 100);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("write_off_seller_debt", {
    p_seller_account_id: sellerId,
    p_currency: currency as "GHS" | "NGN" | "XOF",
    p_amount_minor: amountMinor,
    p_reason: reason,
    p_operator_user_id: actor.userId,
    // One click, one write-off: a double submit gets a new key per form render
    // only if the operator reloads, which is a deliberate second decision.
    p_idempotency_key: String(formData.get("idempotencyKey") ?? randomUUID()),
  });
  if (error) back(path, error.message);

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: "seller_debt_written_off",
    entityType: "seller_account",
    entityId: sellerId,
    before: null,
    after: { amountMinor, currency },
    metadata: { reason, ledgerTransactionId: data },
  });

  revalidatePath(path);
  back(path, "Debt written off.", true);
}

/** Operator records paying a courier invoice for platform-account bookings. */
export async function settleCourierPayableAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin");

  const currency = String(formData.get("currency") ?? "");
  const reference = String(formData.get("reference") ?? "").trim();
  const amount = Number.parseFloat(String(formData.get("amount") ?? ""));
  if (!["GHS", "NGN", "XOF"].includes(currency)) back("/admin", "Choose a currency.");
  if (!Number.isFinite(amount) || amount <= 0) back("/admin", "Enter the amount paid.");
  if (!reference) back("/admin", "Enter the courier's invoice reference.");
  const amountMinor = Math.round(currency === "XOF" ? amount : amount * 100);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("settle_courier_payable", {
    p_currency: currency as "GHS" | "NGN" | "XOF",
    p_amount_minor: amountMinor,
    p_reference: reference,
    p_operator_user_id: actor.userId,
  });
  if (error) back("/admin", error.message);

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: "courier_payable_settled",
    entityType: "ledger",
    entityId: String(data),
    before: null,
    after: { amountMinor, currency },
    metadata: { reference },
  });

  revalidatePath("/admin");
  back("/admin", "Courier invoice recorded.", true);
}
