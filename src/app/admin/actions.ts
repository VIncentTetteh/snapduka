"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { canTransitionCase, type CaseState } from "@/lib/support/transitions";
import { CASE_STATES, COUNTRIES, oneOf } from "@/lib/db/enums";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditEvent } from "@/lib/audit/write";
import { paystackProvider } from "@/lib/payments/paystack";
import { feeBpsToPercent, validateFeePercent } from "@/lib/payments/platform-fee";

export async function resolveCaseAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return;
  const caseId = String(formData.get("caseId"));
  const next = oneOf(String(formData.get("status")), CASE_STATES);
  const resolution = String(formData.get("resolution") ?? "").trim();
  const admin = createAdminClient();
  const { data: current } = await admin.from("support_cases").select("status,order_id").eq("id",caseId).maybeSingle();
  if (!next || !current || !canTransitionCase(current.status as CaseState, next) || (next === "resolved" && !resolution)) return;
  await admin.from("support_cases").update({ status: next, resolution: resolution || null }).eq("id",caseId);
  await admin.from("orders").update({ dispute_status: next }).eq("id",current.order_id);
  await admin.from("case_messages").insert({ case_id: caseId, actor_type: "admin", actor_id: actor.userId, body: resolution || `Case moved to ${next}`, operator_only: false });
  revalidatePath(`/admin/cases/${caseId}`); revalidatePath("/admin/cases");
}

/**
 * Sends the operator back to the queue with a stated reason.
 *
 * reviewPayoutAction used to refuse with a bare `return`: the page re-rendered
 * unchanged and the natural read was that the decision had gone through. On the
 * one action that releases money that is not acceptable, and it is the same
 * defect that made billing silently unpayable (changePlan opened with a silent
 * return, so sellers could not pay and were never told why).
 */
function refusePayoutReview(message: string): never {
  redirect(`/admin/payouts?error=${encodeURIComponent(message)}`);
}

export async function reviewPayoutAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/payouts");
  const payoutId = String(formData.get("payoutId"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "").trim();
  // 'paid' is deliberately absent. This action runs on the service-role client,
  // which bypasses RLS, so the policy restricting operators to approve/reject
  // is not enough on its own — the check has to be here too.
  //
  // Only apply_paystack_transfer_event may set 'paid', because only the
  // provider can know money actually moved. An operator marking a payout paid
  // by hand would leave the seller's balance debited, no transfer in existence,
  // and the books claiming it was settled.
  if (!reason) refusePayoutReview("Add an operational reason before deciding.");
  if (!["approved", "rejected"].includes(decision)) {
    refusePayoutReview("Choose approve or reject.");
  }

  const admin = createAdminClient();
  const { data: payout } = await admin
    .from("payout_requests")
    .select("id,status,seller_account_id,amount_minor,currency")
    .eq("id", payoutId)
    .maybeSingle();
  if (!payout) refusePayoutReview("That payout request no longer exists.");

  // Approving is the trigger: the execute worker picks up 'approved' rows every
  // two minutes, sends the transfer, and the webhook settles it.
  const allowed: Record<string, string[]> = {
    requested: ["approved", "rejected"],
    approved: ["rejected"],
  };
  if (!allowed[payout.status]?.includes(decision)) {
    // Almost always a second operator got there first, or the page is stale.
    refusePayoutReview(
      `This payout is already ${payout.status}, so it cannot be ${decision} now. Reload the queue.`,
    );
  }

  await admin
    .from("payout_requests")
    .update({
      status: decision,
      review_reason: reason,
      reviewed_by: actor.email,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", payoutId);

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: `payout_${decision}`,
    entityType: "payout_request",
    entityId: payoutId,
    before: { status: payout.status },
    after: { status: decision, reason },
    metadata: {
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
  const decision = oneOf(String(formData.get("decision")), ["verified", "rejected"] as const);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!sellerId || !reason || !decision) return;

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

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: `verification_${decision}`,
    entityType: "seller_account",
    entityId: sellerId,
    before: null,
    after: { state: decision, reason },
    metadata: {},
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

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: `discovery_${decision}`,
    entityType: "seller_account",
    entityId: sellerId,
    before: { operator_removed_at: preference.operator_removed_at },
    after: { decision, reason },
    metadata: {},
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

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: "plan_price_updated",
    entityType: "plan_price",
    entityId: priceId,
    before: { amountMinor: price.amount_minor },
    after: { amountMinor, reason },
    metadata: { planId: price.plan_id, country: price.country, interval: price.interval },
  });

  revalidatePath("/admin/plans");
}

/**
 * Changes SnapDuka's share of online sales for one market.
 *
 * percentage_charge is SnapDuka's cut — the seller's subaccount receives the
 * remainder, and Paystack's fee comes out of SnapDuka's share (confirmed
 * against a live split; see @/lib/payments/platform-fee). So lowering this
 * number pays sellers more and shrinks SnapDuka's margin.
 *
 * Paystack stores the rate on each subaccount at creation, so this only governs
 * sellers onboarded from now on. Existing sellers keep their current rate until
 * their subaccount is updated at the provider — syncPlatformFeeAction does that
 * and is what makes the change actually take effect for everyone.
 */
export async function updatePlatformFeeAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return;
  const country = oneOf(String(formData.get("country") ?? "").trim(), COUNTRIES);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason || !country) return;

  const validated = validateFeePercent(String(formData.get("feePercent") ?? ""));
  if (!validated.ok) return;

  const admin = createAdminClient();
  const { data: config } = await admin
    .from("country_configs")
    .select("country,platform_fee_bps")
    .eq("country", country)
    .maybeSingle();
  if (!config || config.platform_fee_bps === validated.bps) return;

  const { error } = await admin
    .from("country_configs")
    .update({ platform_fee_bps: validated.bps, updated_at: new Date().toISOString() })
    .eq("country", country);
  if (error) return;

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: "platform_fee_updated",
    entityType: "country_config",
    before: { platformFeeBps: config.platform_fee_bps },
    after: { platformFeeBps: validated.bps, reason },
    metadata: { country, warning: validated.warning ?? null },
  });

  revalidatePath("/admin/plans");
}

/**
 * Pushes the configured rate onto sellers' existing Paystack subaccounts.
 *
 * Without this a fee change is invisible to every seller who already onboarded,
 * because Paystack holds percentage_charge on the subaccount itself. Each
 * result is recorded so a partial sync is legible rather than looking like it
 * either fully worked or fully failed.
 */
export async function syncPlatformFeeAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator" || formData.get("confirm") !== "yes") return;
  const country = oneOf(String(formData.get("country") ?? "").trim(), COUNTRIES);
  if (!country) return;

  const admin = createAdminClient();
  const { data: config } = await admin
    .from("country_configs")
    .select("platform_fee_bps")
    .eq("country", country)
    .maybeSingle();
  if (!config) return;

  const { data: sellers } = await admin
    .from("seller_accounts")
    .select("id")
    .eq("country", country);
  const sellerIds = (sellers ?? []).map((seller) => seller.id);
  if (!sellerIds.length) return;

  const { data: subaccounts } = await admin
    .from("payment_subaccounts")
    .select("id,provider_subaccount_code,percentage_charge_bps,seller_account_id")
    .eq("provider", "paystack")
    .in("seller_account_id", sellerIds)
    .not("provider_subaccount_code", "is", null);

  let synced = 0;
  const failures: string[] = [];
  for (const subaccount of subaccounts ?? []) {
    if (subaccount.percentage_charge_bps === config.platform_fee_bps) continue;
    try {
      const applied = await paystackProvider().updateSubaccount(
        subaccount.provider_subaccount_code!,
        { percentageCharge: feeBpsToPercent(config.platform_fee_bps) },
      );
      // Record what Paystack echoed back, not what was sent. If the provider
      // clamped or ignored the value, the column should say so — that is the
      // whole point of storing it separately from the configured rate.
      await admin
        .from("payment_subaccounts")
        .update({ percentage_charge_bps: Math.round(applied.percentageCharge * 100) })
        .eq("id", subaccount.id);
      synced++;
    } catch (error) {
      // Paystack is the source of truth for the rate, so the local column is
      // deliberately left alone on failure: recording a rate the provider did
      // not accept would hide the drift this column exists to expose.
      failures.push(subaccount.id);
      console.error(
        `[platform-fee] could not sync subaccount ${subaccount.id}:`,
        error instanceof Error ? error.message : "unknown",
      );
    }
  }

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: "platform_fee_synced",
    entityType: "country_config",
    after: { platformFeeBps: config.platform_fee_bps, synced, failed: failures.length },
    metadata: { country, failedSubaccountIds: failures },
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
  await writeAuditEvent(admin, { actorType:"admin",actorId:actor.userId,action:`risk_${action}`,entityType:"seller_account",entityId:sellerId,before:null,after:{ action, reason },metadata:{ caseId } });
  revalidatePath(`/admin/sellers/${sellerId}`);
}

/**
 * Suspends or reinstates a creator. The only operator write in the creator
 * program — settlement stays between seller and creator, and SnapDuka must not
 * look like an arbiter of who is owed what.
 *
 * Suspension takes effect through current_creator_id(), which only resolves an
 * active creator: a suspended one loses portal access immediately but keeps
 * every accrued commission, because work already done cannot be un-done.
 */
export async function setCreatorStatusAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/creators");

  const creatorId = String(formData.get("creatorId"));
  const status = oneOf(String(formData.get("status")), ["active", "suspended"] as const);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason || !status) return;

  const admin = createAdminClient();
  const { data: creator } = await admin
    .from("creators")
    .select("id,status,handle")
    .eq("id", creatorId)
    .maybeSingle();
  if (!creator || creator.status === status) return;

  await admin.from("creators").update({ status }).eq("id", creatorId);

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: `creator_${status === "suspended" ? "suspended" : "reinstated"}`,
    entityType: "creator",
    entityId: creatorId,
    before: { status: creator.status },
    after: { status, reason },
    metadata: { handle: creator.handle },
  });

  revalidatePath("/admin/creators");
}
