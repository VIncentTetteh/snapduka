"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor, type Actor, type SellerActor } from "@/lib/auth/actor";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { planChange } from "@/lib/billing/change-plan";

function fail(message: string): never {
  redirect(`/dashboard/settings/billing?error=${encodeURIComponent(message)}`);
}

/**
 * Paying us is not the same as being paid by us.
 *
 * These actions used to `return` silently unless the account was `active`, but
 * a seller is `pending` from signup until verification completes — so on a live
 * shop the Upgrade button did nothing at all: no charge, no redirect, no error,
 * nothing to tell the seller why. Verification gates payouts, which is where
 * the risk actually sits. Taking a subscription payment from a pending seller
 * is exactly what should happen.
 *
 * Only accounts genuinely switched off are refused, and every refusal now says
 * so out loud.
 */
function assertCanChangePlan(actor: Actor): asserts actor is SellerActor {
  if (actor.kind !== "seller") fail("Sign in as a seller to change your plan.");
  if (actor.role) fail("Only the account owner can change the plan.");
  // Suspended / closed are refused inside planChange, so the mobile route gets
  // the same rule rather than a second copy of it here.
}


export async function changePlan(formData: FormData) {
  const actor = await resolveServerActor();
  assertCanChangePlan(actor);

  // The decision itself lives in @/lib/billing/change-plan so the mobile route
  // can run exactly the same rules. This wrapper only turns its outcome back
  // into the redirect the web form expects.
  const outcome = await planChange(actor, {
    planCode: String(formData.get("planCode") ?? ""),
    interval: typeof formData.get("interval") === "string" ? String(formData.get("interval")) : null,
  });

  if (!outcome.ok) fail(outcome.message);
  if (outcome.kind === "checkout") redirect(outcome.authorizationUrl);

  revalidatePath("/dashboard/settings/billing");
  revalidatePath("/dashboard", "layout");
}

export async function cancelSubscription() {
  const formData = new FormData();
  formData.set("planCode", "free");
  await changePlan(formData);
}

/**
 * Abandons an upgrade the seller started but never paid for.
 *
 * Only clears the pending fields — the live plan was never touched, which is
 * the whole point of parking an upgrade rather than applying it optimistically.
 */
export async function cancelPendingUpgrade() {
  const actor = await resolveServerActor();
  assertCanChangePlan(actor);

  const admin = createAdminClient();
  await admin
    .from("seller_subscriptions")
    .update({
      pending_change_type: null,
      pending_plan_id: null,
      pending_plan_version: null,
      pending_price_id: null,
    })
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("pending_change_type", "upgrade");

  revalidatePath("/dashboard/settings/billing");
}

/**
 * Calls off a scheduled downgrade or cancellation.
 *
 * A downgrade disables the Paystack subscription immediately and parks the new
 * plan in the pending_* columns for the cron to apply at period end. There was
 * no way back from that: the cancel control was hidden once anything was
 * pending, and re-picking the current plan was rejected as "You are already on
 * this plan" — true, but only until the period ended. Sellers were dropped with
 * no way to stop it.
 *
 * Paystack is re-enabled BEFORE the pending change is cleared. The other order
 * would leave the row claiming an active plan that silently never renews, which
 * is the worse of the two failures: the seller sees nothing wrong until their
 * card is never charged and their plan lapses anyway.
 */
export async function keepCurrentPlan() {
  const actor = await resolveServerActor();
  assertCanChangePlan(actor);

  const admin = createAdminClient();
  const supabase = await createClient();
  const { data: existing, error } = await supabase
    .from("seller_subscriptions")
    .select("id,pending_change_type,provider_subscription_code,provider_email_token")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (error) {
    console.error("[keepCurrentPlan] seller_subscriptions query failed", error);
    fail("Could not load your subscription. Try again shortly.");
  }
  if (!existing) fail("There is no subscription to keep.");
  if (existing.pending_change_type !== "downgrade" && existing.pending_change_type !== "cancel") {
    fail("There is no scheduled change to call off.");
  }

  if (existing.provider_subscription_code && existing.provider_email_token) {
    try {
      await paystackProvider().enableSubscription(
        existing.provider_subscription_code,
        existing.provider_email_token,
      );
    } catch {
      fail("Paystack could not restart your renewal. Try again shortly.");
    }
  }

  await admin
    .from("seller_subscriptions")
    .update({
      pending_change_type: null,
      pending_plan_id: null,
      pending_plan_version: null,
      pending_price_id: null,
      cancelled_at: null,
    })
    .eq("id", existing.id);

  revalidatePath("/dashboard/settings/billing");
  revalidatePath("/dashboard", "layout");
}
