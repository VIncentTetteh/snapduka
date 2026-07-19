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

// How many days past current_period_end a downgrade may keep retrying the
// headless Paystack charge before we give up and fail safe to Free. The row
// is retried once per daily cron run, so 3 days means ~3 failed attempts —
// enough to ride out a transient Paystack outage without leaving a seller on
// their old (higher) plan indefinitely when the failure is permanent (e.g. a
// cancelled card).
const DOWNGRADE_RETRY_GRACE_DAYS = 3;

/**
 * Applies scheduled downgrades/cancellations once current_period_end has
 * passed. changePlan disables the seller's old Paystack subscription
 * immediately (so it stops renewing) but leaves entitlements untouched
 * until this cron runs — the seller keeps what they paid for. Safe to
 * re-invoke: a row only matches the initial query while pending_change_type
 * is still set, so an already-applied row is naturally skipped on rerun. A
 * failed downgrade leaves pending_change_type set so the next run retries —
 * EXCEPT when the seller's card was already charged via Paystack and only
 * the follow-up persist failed: there, pending_change_type is cleared via a
 * best-effort update instead, because leaving it set would let tomorrow's
 * run match this row again and charge the card a second time.
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
      "id,pending_change_type,pending_plan_id,pending_plan_version,pending_price_id,provider_authorization_code,provider_customer_code,current_period_end",
    )
    .not("pending_change_type", "is", null)
    .lte("current_period_end", now.toISOString());

  let applied = 0;
  let failed = 0;

  for (const row of due ?? []) {
    // Isolate each row: a thrown error anywhere in this row's handling (DB or
    // Paystack) must not abort the batch — the remaining due rows still need
    // to run this cycle. A row that errors here is safely retried next run.
    try {
      if (row.pending_change_type === "cancel") {
        const { error } = await admin
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
        if (error) {
          console.error("[apply-plan-changes] failed to persist cancellation", { rowId: row.id, error });
          failed += 1;
        } else {
          applied += 1;
        }
        continue;
      }

      if (!row.provider_authorization_code || !row.provider_customer_code) {
        // No stored card to charge headlessly — fail safe to Free rather than
        // silently not billing.
        const { error } = await admin
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
        if (error) {
          console.error("[apply-plan-changes] failed to persist fail-safe cancellation", { rowId: row.id, error });
        }
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

        // The seller's card is now charged and a Paystack subscription exists.
        // Persisting that onto seller_subscriptions must not silently fail: if
        // it does, pending_change_type stays set and tomorrow's run would
        // charge the card again (createSubscriptionForAuthorization has no
        // idempotency key). Retry once to close the most likely transient
        // failure window, then stop and demand manual reconciliation rather
        // than risk a second charge.
        const persistUpdate = () =>
          admin
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

        let persisted = false;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 2 && !persisted; attempt += 1) {
          try {
            const { error } = await persistUpdate();
            if (error) {
              lastError = error;
            } else {
              persisted = true;
            }
          } catch (err) {
            lastError = err;
          }
        }

        if (persisted) {
          applied += 1;
        } else {
          // The card is already charged. Leaving pending_change_type set here
          // would let tomorrow's "due" query match this row again and charge
          // the card a second time — a log message doesn't stop an automated
          // cron from re-running. Make one best-effort, non-retried attempt
          // to clear just the pending marker so this row stops matching. The
          // row's plan_id/state/current_period_end are still stale either
          // way and need manual reconciliation against what Paystack has.
          let clearError: unknown = null;
          try {
            const { error } = await admin
              .from("seller_subscriptions")
              .update({ pending_change_type: null })
              .eq("id", row.id);
            clearError = error;
          } catch (err) {
            clearError = err;
          }

          if (clearError) {
            console.error(
              `CRITICAL: seller charged via Paystack (subscription ${subscription.subscriptionCode}) but failed to persist to seller_subscriptions after retry — row ${row.id} needs manual reconciliation. The best-effort pending_change_type clear ALSO FAILED, so this row may be picked up and charged again on the next run.`,
              { persistError: lastError, clearError },
            );
          } else {
            console.error(
              `CRITICAL: seller charged via Paystack (subscription ${subscription.subscriptionCode}) but failed to persist to seller_subscriptions after retry — row ${row.id} needs manual reconciliation of plan_id/state/current_period_end. pending_change_type was cleared to prevent a repeat charge on the next run.`,
              { persistError: lastError },
            );
          }
          failed += 1;
        }
      } catch (err) {
        console.error("[apply-plan-changes] failed to create subscription for authorization", { rowId: row.id, error: err });

        // TODO: once the Paystack integration supports idempotency keys, check
        // here whether the charge actually went through despite the throw
        // (rather than assuming it didn't) before deciding to keep retrying.
        const periodEndMs = row.current_period_end ? new Date(row.current_period_end).getTime() : NaN;
        const daysPastPeriodEnd = Number.isNaN(periodEndMs) ? 0 : (now.getTime() - periodEndMs) / (1000 * 60 * 60 * 24);

        if (daysPastPeriodEnd > DOWNGRADE_RETRY_GRACE_DAYS) {
          // The headless charge has been failing since before the grace
          // period — most likely a permanent failure (declined/cancelled
          // card, revoked authorization) rather than a transient one. Retrying
          // forever would leave the seller on their old, higher-tier plan
          // indefinitely past what they paid for. Fail safe to Free, mirroring
          // the no-stored-authorization branch above.
          const { error } = await admin
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
          if (error) {
            console.error("[apply-plan-changes] failed to persist fail-safe cancellation after grace period", { rowId: row.id, error });
          }
          console.error(
            "[apply-plan-changes] downgrade retry exhausted after grace period, failing safe to Free",
            { rowId: row.id, currentPeriodEnd: row.current_period_end, daysPastPeriodEnd },
          );
        }
        // Within the grace period: pending_change_type left set on the row —
        // retried on the next run.
        failed += 1;
      }
    } catch (err) {
      console.error("[apply-plan-changes] unexpected error processing row", { rowId: row.id, error: err });
      failed += 1;
    }
  }

  return NextResponse.json({ applied, failed, total: due?.length ?? 0 });
}

export const GET = POST;
