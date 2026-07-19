import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

function periodEnd(start: Date, interval: string): string {
  const end = new Date(start);
  if (interval === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end.toISOString();
}

/**
 * Applies scheduled downgrades/cancellations once current_period_end has
 * passed. changePlan disables the seller's old Paystack subscription
 * immediately (so it stops renewing) but leaves entitlements untouched
 * until this cron runs — the seller keeps what they paid for. Safe to
 * re-invoke: a row only matches the initial query while pending_change_type
 * is still set, so an already-applied row is naturally skipped on rerun. A
 * failed downgrade leaves pending_change_type set so the next run retries.
 */
export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  const now = new Date();
  const { data: due } = await admin
    .from("seller_subscriptions")
    .select(
      "id,pending_change_type,pending_plan_id,pending_plan_version,pending_price_id,provider_authorization_code,provider_customer_code",
    )
    .not("pending_change_type", "is", null)
    .lte("current_period_end", now.toISOString());

  let applied = 0;
  let failed = 0;

  for (const row of due ?? []) {
    if (row.pending_change_type === "cancel") {
      await admin
        .from("seller_subscriptions")
        .update({
          state: "cancelled",
          cancelled_at: now.toISOString(),
          pending_change_type: null,
          pending_plan_id: null,
          pending_plan_version: null,
          pending_price_id: null,
        })
        .eq("id", row.id)
        .eq("pending_change_type", "cancel");
      applied += 1;
      continue;
    }

    if (!row.provider_authorization_code || !row.provider_customer_code) {
      // No stored card to charge headlessly — fail safe to Free rather than
      // silently not billing.
      await admin
        .from("seller_subscriptions")
        .update({
          state: "cancelled",
          cancelled_at: now.toISOString(),
          pending_change_type: null,
          pending_plan_id: null,
          pending_plan_version: null,
          pending_price_id: null,
        })
        .eq("id", row.id)
        .eq("pending_change_type", "downgrade");
      failed += 1;
      continue;
    }

    const { data: price } = await admin
      .from("plan_prices")
      .select("id,amount_minor,currency,interval,provider_plan_code,plans(name)")
      .eq("id", row.pending_price_id)
      .maybeSingle();
    if (!price) {
      failed += 1;
      continue;
    }

    let providerPlanCode = price.provider_plan_code;
    if (!providerPlanCode) {
      try {
        const planRow = price.plans as { name?: string } | { name?: string }[] | null;
        const planName = Array.isArray(planRow) ? planRow[0]?.name : planRow?.name;
        const created = await paystackProvider().createPlan({
          name: `SnapDuka ${planName ?? "plan"} (${price.currency} ${price.interval})`,
          interval: price.interval === "yearly" ? "annually" : "monthly",
          amountMinor: price.amount_minor,
          currency: price.currency,
        });
        providerPlanCode = created.planCode;
        await admin.from("plan_prices").update({ provider_plan_code: providerPlanCode }).eq("id", price.id);
      } catch {
        failed += 1;
        continue;
      }
    }

    try {
      const subscription = await paystackProvider().createSubscriptionForAuthorization({
        customerCode: row.provider_customer_code,
        planCode: providerPlanCode,
        authorizationCode: row.provider_authorization_code,
      });
      await admin
        .from("seller_subscriptions")
        .update({
          plan_id: row.pending_plan_id,
          plan_version: row.pending_plan_version,
          price_id: row.pending_price_id,
          state: "active",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd(now, price.interval),
          provider_subscription_code: subscription.subscriptionCode,
          provider_email_token: subscription.emailToken,
          pending_change_type: null,
          pending_plan_id: null,
          pending_plan_version: null,
          pending_price_id: null,
        })
        .eq("id", row.id)
        .eq("pending_change_type", "downgrade");
      applied += 1;
    } catch {
      failed += 1;
      // pending_change_type left set on the row — retried on the next run.
    }
  }

  return NextResponse.json({ applied, failed, total: due?.length ?? 0 });
}

export const GET = POST;
