"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { canTransitionCase, type CaseState } from "@/lib/support/transitions";
import { CASE_STATES, COUNTRIES, oneOf } from "@/lib/db/enums";
import { createAdminClient } from "@/lib/supabase/admin";
import { paginate } from "@/lib/supabase/paginate";
import { writeAuditEvent } from "@/lib/audit/write";
import { paystackProvider } from "@/lib/payments/paystack";
import { feeBpsToPercent, validateFeePercent } from "@/lib/payments/platform-fee";

/**
 * Moving a support case, and with it a dispute on somebody's order.
 *
 * This was the only privileged action in the file with no audit event, and its
 * three writes all discarded their errors — so a case could be marked resolved
 * on screen while `orders.dispute_status` still said otherwise, with no record
 * that an operator had touched it at all. It also refused in silence on four
 * different conditions, including the one an operator meets in normal use:
 * resolving a case without typing a resolution.
 */
function refuseCase(caseId: string, message: string): never {
  const path = caseId ? `/admin/cases/${caseId}` : "/admin/cases";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function resolveCaseAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/cases");

  const caseId = String(formData.get("caseId") ?? "");
  const next = oneOf(String(formData.get("status")), CASE_STATES);
  const resolution = String(formData.get("resolution") ?? "").trim();

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("support_cases")
    .select("status,order_id")
    .eq("id", caseId)
    .maybeSingle();

  if (!current) refuseCase(caseId, "That case could not be found.");
  if (!next) refuseCase(caseId, "Choose a status to move the case to.");
  if (!canTransitionCase(current.status as CaseState, next)) {
    refuseCase(caseId, `A case cannot go from ${current.status} to ${next}.`);
  }
  if (next === "resolved" && !resolution) {
    refuseCase(caseId, "Write what the resolution was before resolving the case.");
  }

  const { error: caseError } = await admin
    .from("support_cases")
    .update({ status: next, resolution: resolution || null })
    .eq("id", caseId);
  if (caseError) refuseCase(caseId, "That case could not be updated.");

  // The order's dispute status is what the buyer and seller actually see. It
  // silently not moving with the case is the divergence worth catching.
  if (current.order_id) {
    const { error: orderError } = await admin
      .from("orders")
      .update({ dispute_status: next })
      .eq("id", current.order_id);
    if (orderError) {
      refuseCase(
        caseId,
        "The case moved but the order's dispute status did not. Check the order before continuing.",
      );
    }
  }

  const { error: messageError } = await admin.from("case_messages").insert({
    case_id: caseId,
    actor_type: "admin",
    actor_id: actor.userId,
    body: resolution || `Case moved to ${next}`,
    operator_only: false,
  });
  if (messageError) {
    console.error("[resolveCaseAction] case moved but the note was not recorded", {
      caseId,
      error: messageError,
    });
  }

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: `case_${next}`,
    entityType: "support_case",
    entityId: caseId,
    before: { status: current.status },
    after: { status: next, resolution: resolution || null },
    metadata: { orderId: current.order_id },
  });

  revalidatePath(`/admin/cases/${caseId}`);
  revalidatePath("/admin/cases");
  redirect(`/admin/cases/${caseId}?saved=1`);
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

/** Back to the seller the operator was working on, with a stated reason. */
function refuseSellerAction(sellerId: string, message: string): never {
  const path = sellerId ? `/admin/sellers/${sellerId}` : "/admin/sellers";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function approveVerificationAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/sellers");
  const sellerId = String(formData.get("sellerId") ?? "");
  const decision = oneOf(String(formData.get("decision")), ["verified", "rejected"] as const);
  const reason = String(formData.get("reason") ?? "").trim();
  // Verification gates payouts, so an operator believing they had approved a
  // seller who is still unverified is a real failure, not a cosmetic one.
  if (!sellerId) refuseSellerAction(sellerId, "That seller could not be identified.");
  if (!decision) refuseSellerAction(sellerId, "Choose whether to verify or reject.");
  if (!reason) refuseSellerAction(sellerId, "Record why before deciding.");

  const admin = createAdminClient();
  const { data: seller } = await admin
    .from("seller_accounts")
    .select("id")
    .eq("id", sellerId)
    .maybeSingle();
  if (!seller) refuseSellerAction(sellerId, "That seller account no longer exists.");

  const now = new Date().toISOString();
  // The verified state requires provider + provider_reference + checked_at
  // (seller_verifications_verified_fields_check).
  const { error: verificationError } = await admin.from("seller_verifications").upsert(
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
  if (verificationError) {
    refuseSellerAction(sellerId, "That verification decision could not be saved.");
  }

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
  if (actor.kind !== "operator") redirect("/login?next=/admin/sellers");
  const sellerId = String(formData.get("sellerId") ?? "");
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!sellerId) refuseSellerAction(sellerId, "That seller could not be identified.");
  if (!["remove", "restore"].includes(decision)) {
    refuseSellerAction(sellerId, "Choose whether to remove or restore the listing.");
  }
  if (!reason) refuseSellerAction(sellerId, "Record why before changing the listing.");

  const admin = createAdminClient();
  const { data: preference } = await admin
    .from("discovery_preferences")
    .select("shop_id,operator_removed_at")
    .eq("seller_account_id", sellerId)
    .maybeSingle();
  // A seller who never opted in has no row, so there is nothing to remove —
  // which is worth saying, because it looks the same as a failed removal.
  if (!preference) {
    refuseSellerAction(sellerId, "This seller is not listed in discovery.");
  }

  const { error: removalError } = await admin
    .from("discovery_preferences")
    .update({ operator_removed_at: decision === "remove" ? new Date().toISOString() : null })
    .eq("seller_account_id", sellerId);
  if (removalError) {
    refuseSellerAction(sellerId, "That discovery change could not be saved.");
  }
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
  if (actor.kind !== "operator") redirect("/login?next=/admin/cases");
  const caseId = String(formData.get("caseId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const operatorOnly = formData.get("operatorOnly") === "on";
  if (!body) refuseCase(caseId, "Write a message before sending it.");

  const admin = createAdminClient();
  // A discarded error here loses a reply the operator believes they sent, and
  // on a case that is visible to the buyer.
  const { error } = await admin.from("case_messages").insert({
    case_id: caseId,
    actor_type: "admin",
    actor_id: actor.userId,
    body,
    operator_only: operatorOnly,
  });
  if (error) refuseCase(caseId, "That message could not be sent.");

  revalidatePath(`/admin/cases/${caseId}`);
}

/** Back to the plans and fees screen with a stated reason. */
function refusePlans(message: string): never {
  redirect(`/admin/plans?error=${encodeURIComponent(message)}`);
}

export async function updatePlanPriceAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/plans");
  const priceId = String(formData.get("priceId"));
  const amountValue = String(formData.get("amountMinor") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const amountMinor = Number.parseInt(amountValue, 10);
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    refusePlans("Enter the new price as a whole number of minor units.");
  }
  if (!reason) refusePlans("Record why this price is changing.");

  const admin = createAdminClient();
  const { data: price } = await admin
    .from("plan_prices")
    .select("id,plan_id,country,interval,amount_minor,currency")
    .eq("id", priceId)
    .maybeSingle();
  if (!price) refusePlans("That price could not be found.");
  // A no-op is worth saying out loud: otherwise the operator cannot tell it
  // apart from a change that failed to save.
  if (price.amount_minor === amountMinor) {
    refusePlans("That price is already set to this amount.");
  }

  const { error: priceError } = await admin
    .from("plan_prices")
    .update({ amount_minor: amountMinor })
    .eq("id", priceId);
  if (priceError) refusePlans("That price could not be updated.");

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
  redirect(`/admin/plans?saved=${encodeURIComponent("Price updated.")}`);
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
  if (actor.kind !== "operator") redirect("/login?next=/admin/plans");
  const country = oneOf(String(formData.get("country") ?? "").trim(), COUNTRIES);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!country) refusePlans("Choose which market this fee applies to.");
  if (!reason) refusePlans("Record why the platform fee is changing.");

  // validateFeePercent already writes a precise message — "the lowest allowed
  // fee is…", "enter a percentage, for example 7" — and it was being thrown
  // away, leaving the operator with a form that simply did nothing.
  const validated = validateFeePercent(String(formData.get("feePercent") ?? ""));
  if (!validated.ok) refusePlans(validated.error);

  const admin = createAdminClient();
  const { data: config } = await admin
    .from("country_configs")
    .select("country,platform_fee_bps")
    .eq("country", country)
    .maybeSingle();
  if (!config) refusePlans("That market is not configured.");
  if (config.platform_fee_bps === validated.bps) {
    refusePlans("The fee for that market is already set to this rate.");
  }

  // This is SnapDuka's share of every online sale in the market. An operator
  // believing they had changed it when they had not is the failure to avoid.
  const { error } = await admin
    .from("country_configs")
    .update({ platform_fee_bps: validated.bps, updated_at: new Date().toISOString() })
    .eq("country", country);
  if (error) refusePlans("That fee could not be updated.");

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
  if (actor.kind !== "operator") redirect("/login?next=/admin/plans");
  if (formData.get("confirm") !== "yes") {
    refusePlans("Confirm the sync before running it.");
  }
  const country = oneOf(String(formData.get("country") ?? "").trim(), COUNTRIES);
  if (!country) refusePlans("Choose which market to sync.");

  const admin = createAdminClient();
  const { data: config } = await admin
    .from("country_configs")
    .select("platform_fee_bps")
    .eq("country", country)
    .maybeSingle();
  if (!config) refusePlans("That market is not configured.");

  // Previously this read every seller in the market, mapped them to ids, and
  // passed the lot to `.in(...)` — two unbounded reads feeding a filter whose
  // URL grows with the seller count. Both were capped at db.max_rows, so in a
  // market with more than a thousand sellers the sync would quietly cover only
  // some of them and still report success. Filtering on the embedded seller
  // and paging by id removes both problems.
  const { rows: subaccounts, error: readError } = await paginate(
    (cursor, size) => {
      let page = admin
        .from("payment_subaccounts")
        .select(
          "id,provider_subaccount_code,percentage_charge_bps,seller_account_id,seller_accounts!inner(country)",
        )
        .eq("provider", "paystack")
        .eq("seller_accounts.country", country)
        .not("provider_subaccount_code", "is", null)
        .order("id", { ascending: true })
        .limit(size);
      if (cursor) page = page.gt("id", cursor);
      return page;
    },
    (row) => row.id,
  );
  if (readError) refusePlans("The subaccounts for that market could not be read.");
  if (subaccounts.length === 0) {
    refusePlans("No Paystack subaccounts in that market need syncing.");
  }

  let synced = 0;
  const failures: string[] = [];
  for (const subaccount of subaccounts) {
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

  // A partial sync is the normal outcome when Paystack rejects some updates,
  // and it used to look identical to a clean run.
  redirect(
    failures.length > 0
      ? `/admin/plans?error=${encodeURIComponent(
          `Synced ${synced} subaccount${synced === 1 ? "" : "s"}; ${failures.length} could not be updated at Paystack.`,
        )}`
      : `/admin/plans?saved=${encodeURIComponent(`Synced ${synced} subaccount${synced === 1 ? "" : "s"}.`)}`,
  );
}

const RISK_ACTIONS = [
  "warning",
  "require_verification",
  "restrict_payments",
  "suspend",
  "remove",
] as const;

/**
 * Enforcement against a seller — up to suspending or closing their account.
 *
 * Every refusal here was silent, and every write discarded its error. The
 * dangerous shape was the combination: `risk_actions` records that enforcement
 * happened, and the status change is what actually enforces it. If the second
 * write failed, the log said the seller was suspended and the seller carried on
 * trading, with nothing to reconcile the two.
 */
export async function applyRiskAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/sellers");

  const sellerId = String(formData.get("sellerId") ?? "");
  const caseId = String(formData.get("caseId") ?? "") || null;
  const action = String(formData.get("riskAction"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (formData.get("confirm") !== "yes") {
    refuseSellerAction(sellerId, "Confirm before applying an enforcement action.");
  }
  if (!(RISK_ACTIONS as readonly string[]).includes(action)) {
    refuseSellerAction(sellerId, "Choose which enforcement action to apply.");
  }
  if (!reason) refuseSellerAction(sellerId, "Record why before applying it.");

  const admin = createAdminClient();
  const { data: seller } = await admin
    .from("seller_accounts")
    .select("id")
    .eq("id", sellerId)
    .maybeSingle();
  if (!seller) refuseSellerAction(sellerId, "That seller account no longer exists.");

  const { error: recordError } = await admin.from("risk_actions").insert({
    seller_account_id: sellerId,
    case_id: caseId,
    operator_user_id: actor.userId,
    action,
    reason,
  });
  if (recordError) {
    refuseSellerAction(sellerId, "That enforcement action could not be recorded.");
  }

  // The record above says it happened; these are what make it so. A failure
  // here has to be loud, because the two would otherwise disagree.
  let enforcementError: unknown = null;
  if (action === "restrict_payments") {
    ({ error: enforcementError } = await admin
      .from("payment_subaccounts")
      .update({ status: "restricted" })
      .eq("seller_account_id", sellerId));
  } else if (action === "suspend") {
    ({ error: enforcementError } = await admin
      .from("seller_accounts")
      .update({ status: "suspended", is_active: false })
      .eq("id", sellerId));
  } else if (action === "remove") {
    ({ error: enforcementError } = await admin
      .from("seller_accounts")
      .update({ status: "closed", is_active: false })
      .eq("id", sellerId));
  }

  await writeAuditEvent(admin, {
    actorType: "admin",
    actorId: actor.userId,
    action: `risk_${action}`,
    entityType: "seller_account",
    entityId: sellerId,
    before: null,
    after: { action, reason, enforced: !enforcementError },
    metadata: { caseId },
  });

  revalidatePath(`/admin/sellers/${sellerId}`);

  if (enforcementError) {
    console.error("[applyRiskAction] recorded but not enforced", { sellerId, action, enforcementError });
    refuseSellerAction(
      sellerId,
      "The action was recorded but could not be applied to the account. The seller is still trading — try again.",
    );
  }

  redirect(`/admin/sellers/${sellerId}?saved=${encodeURIComponent(`Applied: ${action.replace(/_/g, " ")}.`)}`);
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
  // Explicitly typed `never` so TypeScript treats it as never-returning and
  // narrows the lookups below it.
  const refuse: (message: string) => never = (message) =>
    redirect(`/admin/creators?error=${encodeURIComponent(message)}`);
  if (!status) refuse("Choose whether to suspend or reinstate.");
  if (!reason) refuse("Record why before changing a creator's status.");

  const admin = createAdminClient();
  const { data: creator } = await admin
    .from("creators")
    .select("id,status,handle")
    .eq("id", creatorId)
    .maybeSingle();
  if (!creator) refuse("That creator could not be found.");
  // Worth saying rather than doing nothing: suspending an already-suspended
  // creator looks the same as a failed suspension.
  if (creator.status === status) {
    refuse(`@${creator.handle} is already ${status}.`);
  }

  const { error } = await admin.from("creators").update({ status }).eq("id", creatorId);
  if (error) refuse("That status change could not be saved.");

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
  redirect(
    `/admin/creators?saved=${encodeURIComponent(
      `@${creator.handle} ${status === "suspended" ? "suspended" : "reinstated"}.`,
    )}`,
  );
}
