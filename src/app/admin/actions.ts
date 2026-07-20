"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { canTransitionCase, type CaseState } from "@/lib/support/transitions";
import { createAdminClient } from "@/lib/supabase/admin";

export async function resolveCaseAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return;
  const caseId = String(formData.get("caseId"));
  const next = String(formData.get("status")) as CaseState;
  const resolution = String(formData.get("resolution") ?? "").trim();
  const admin = createAdminClient();
  const { data: current } = await admin.from("support_cases").select("status,order_id").eq("id",caseId).maybeSingle();
  if (!current || !canTransitionCase(current.status,next) || (next === "resolved" && !resolution)) return;
  await admin.from("support_cases").update({ status: next, resolution: resolution || null }).eq("id",caseId);
  await admin.from("orders").update({ dispute_status: next }).eq("id",current.order_id);
  await admin.from("case_messages").insert({ case_id: caseId, actor_type: "admin", actor_id: actor.userId, body: resolution || `Case moved to ${next}`, operator_only: false });
  revalidatePath(`/admin/cases/${caseId}`); revalidatePath("/admin/cases");
}

export async function reviewPayoutAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/payouts");
  const payoutId = String(formData.get("payoutId"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason || !["approved", "rejected", "paid"].includes(decision)) return;

  const admin = createAdminClient();
  const { data: payout } = await admin
    .from("payout_requests")
    .select("id,status,seller_account_id,amount_minor,currency")
    .eq("id", payoutId)
    .maybeSingle();
  if (!payout) return;

  const allowed: Record<string, string[]> = {
    requested: ["approved", "rejected"],
    approved: ["paid", "rejected"],
  };
  if (!allowed[payout.status]?.includes(decision)) return;

  await admin
    .from("payout_requests")
    .update({
      status: decision,
      review_reason: reason,
      reviewed_by: actor.email,
      reviewed_at: new Date().toISOString(),
      paid_at: decision === "paid" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payoutId);

  await admin.rpc("write_audit_event", {
    p_actor_type: "admin",
    p_actor_id: actor.userId,
    p_action: `payout_${decision}`,
    p_entity_type: "payout_request",
    p_entity_id: payoutId,
    p_before_data: { status: payout.status },
    p_after_data: { status: decision, reason },
    p_metadata: {
      sellerAccountId: payout.seller_account_id,
      amountMinor: payout.amount_minor,
      currency: payout.currency,
    },
  });

  revalidatePath("/admin/payouts");
  revalidatePath("/admin");
}

export async function approveVerificationAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return;
  const sellerId = String(formData.get("sellerId"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!sellerId || !reason || !["verified", "rejected"].includes(decision)) return;

  const admin = createAdminClient();
  const { data: seller } = await admin
    .from("seller_accounts")
    .select("id")
    .eq("id", sellerId)
    .maybeSingle();
  if (!seller) return;

  const now = new Date().toISOString();
  // The verified state requires provider + provider_reference + checked_at
  // (seller_verifications_verified_fields_check).
  await admin.from("seller_verifications").upsert(
    {
      seller_account_id: sellerId,
      state: decision,
      provider: "operator",
      provider_reference: `op-${crypto.randomUUID()}`,
      checked_at: now,
      updated_at: now,
      metadata: { reviewedBy: actor.email, reason },
    },
    { onConflict: "seller_account_id" },
  );

  await admin.rpc("write_audit_event", {
    p_actor_type: "admin",
    p_actor_id: actor.userId,
    p_action: `verification_${decision}`,
    p_entity_type: "seller_account",
    p_entity_id: sellerId,
    p_before_data: null,
    p_after_data: { state: decision, reason },
    p_metadata: {},
  });

  revalidatePath(`/admin/sellers/${sellerId}`);
}

/**
 * Operator kill switch for the public discovery directory: sets/clears
 * discovery_preferences.operator_removed_at and re-snapshots the listing so
 * the change is visible immediately. Audit-logged with a mandatory reason.
 */
export async function setDiscoveryRemovalAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return;
  const sellerId = String(formData.get("sellerId"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!sellerId || !reason || !["remove", "restore"].includes(decision)) return;

  const admin = createAdminClient();
  const { data: preference } = await admin
    .from("discovery_preferences")
    .select("shop_id,operator_removed_at")
    .eq("seller_account_id", sellerId)
    .maybeSingle();
  if (!preference) return;

  await admin
    .from("discovery_preferences")
    .update({ operator_removed_at: decision === "remove" ? new Date().toISOString() : null })
    .eq("seller_account_id", sellerId);
  await admin.rpc("refresh_discovery_listing", { p_shop_id: preference.shop_id });

  await admin.rpc("write_audit_event", {
    p_actor_type: "admin",
    p_actor_id: actor.userId,
    p_action: `discovery_${decision}`,
    p_entity_type: "seller_account",
    p_entity_id: sellerId,
    p_before_data: { operator_removed_at: preference.operator_removed_at },
    p_after_data: { decision, reason },
    p_metadata: {},
  });

  revalidatePath(`/admin/sellers/${sellerId}`);
  revalidatePath("/discover");
}

export async function addCaseMessageAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return;
  const caseId = String(formData.get("caseId"));
  const body = String(formData.get("body") ?? "").trim();
  const operatorOnly = formData.get("operatorOnly") === "on";
  if (!body) return;

  const admin = createAdminClient();
  await admin.from("case_messages").insert({
    case_id: caseId,
    actor_type: "admin",
    actor_id: actor.userId,
    body,
    operator_only: operatorOnly,
  });

  revalidatePath(`/admin/cases/${caseId}`);
}

export async function updatePlanPriceAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return;
  const priceId = String(formData.get("priceId"));
  const amountValue = String(formData.get("amountMinor") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const amountMinor = Number.parseInt(amountValue, 10);
  if (!reason || !Number.isInteger(amountMinor) || amountMinor < 0) return;

  const admin = createAdminClient();
  const { data: price } = await admin
    .from("plan_prices")
    .select("id,plan_id,country,interval,amount_minor,currency")
    .eq("id", priceId)
    .maybeSingle();
  if (!price || price.amount_minor === amountMinor) return;

  await admin.from("plan_prices").update({ amount_minor: amountMinor }).eq("id", priceId);

  await admin.rpc("write_audit_event", {
    p_actor_type: "admin",
    p_actor_id: actor.userId,
    p_action: "plan_price_updated",
    p_entity_type: "plan_price",
    p_entity_id: priceId,
    p_before_data: { amountMinor: price.amount_minor },
    p_after_data: { amountMinor, reason },
    p_metadata: { planId: price.plan_id, country: price.country, interval: price.interval },
  });

  revalidatePath("/admin/plans");
}

export async function applyRiskAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator" || formData.get("confirm") !== "yes") return;
  const sellerId = String(formData.get("sellerId"));
  const caseId = String(formData.get("caseId") ?? "") || null;
  const action = String(formData.get("riskAction"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason || !["warning","require_verification","restrict_payments","suspend","remove"].includes(action)) return;
  const admin = createAdminClient();
  const { data: seller } = await admin.from("seller_accounts").select("id").eq("id", sellerId).maybeSingle();
  if (!seller) return;
  await admin.from("risk_actions").insert({ seller_account_id: sellerId, case_id: caseId, operator_user_id: actor.userId, action, reason });
  if (action === "restrict_payments") await admin.from("payment_subaccounts").update({ status: "restricted" }).eq("seller_account_id",sellerId);
  if (action === "suspend") await admin.from("seller_accounts").update({ status: "suspended", is_active: false }).eq("id",sellerId);
  if (action === "remove") await admin.from("seller_accounts").update({ status: "closed", is_active: false }).eq("id",sellerId);
  await admin.rpc("write_audit_event", { p_actor_type:"admin",p_actor_id:actor.userId,p_action:`risk_${action}`,p_entity_type:"seller_account",p_entity_id:sellerId,p_before_data:null,p_after_data:{ action, reason },p_metadata:{ caseId } });
  revalidatePath(`/admin/sellers/${sellerId}`);
}
