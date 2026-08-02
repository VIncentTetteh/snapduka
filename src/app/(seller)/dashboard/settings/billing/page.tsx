import Link from "next/link";
import { Suspense } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/surface";
import { SubmitButton } from "@/components/ui/submit-button";
import { resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan } from "@/lib/billing/resolve";
import type { EntitlementValue } from "@/lib/billing/resolve";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

import { cancelPendingUpgrade, cancelSubscription, changePlan } from "./actions";
import { SubscriptionVerifier } from "./subscription-verifier";

type PlanRow = {
  code: string;
  name: string;
  entitlements: Record<string, EntitlementValue>;
  plan_prices: {
    id: string;
    country: string;
    currency: string;
    interval: string;
    amount_minor: number;
    active: boolean;
  }[];
};

const STATE_TONE: Record<string, BadgeTone> = {
  active: "success",
  grace: "warn",
  past_due: "warn",
  trialing: "neutral",
  cancelled: "neutral",
  expired: "danger",
  free: "accent",
};

const TIER: Record<string, number> = { free: 0, growth: 1, scale: 2 };

/** Human bullets from the entitlements JSON, in presentation order. */
function featureBullets(entitlements: Record<string, EntitlementValue>): string[] {
  const n = (key: string) => entitlements[key];
  const bullets: (string | null)[] = [
    typeof n("products") === "number" ? `Up to ${n("products")} products` : null,
    typeof n("staffAccounts") === "number"
      ? Number(n("staffAccounts")) > 1
        ? `${n("staffAccounts")} staff accounts`
        : "Owner account only"
      : null,
    n("campaigns") === true ? "Tracked share links" : null,
    n("creatorProgram") === true && typeof n("creatorPartnerships") === "number"
      ? `Pay up to ${n("creatorPartnerships")} creators on commission`
      : null,
    n("promotions") === true ? "Discount promotions" : null,
    typeof n("customerSegments") === "number" && Number(n("customerSegments")) > 0
      ? `${n("customerSegments")} customer segments`
      : null,
    typeof n("broadcastsPerMonth") === "number" && Number(n("broadcastsPerMonth")) > 0
      ? `${n("broadcastsPerMonth")} broadcasts per month`
      : null,
    n("branding") === true ? "Storefront theming" : null,
    n("customDomain") === true ? "Custom domain" : null,
    n("exports") === true ? "CSV order exports" : null,
    typeof n("automationRules") === "number" && Number(n("automationRules")) > 0
      ? `${n("automationRules")} automation rules`
      : null,
    typeof n("apiKeys") === "number" && Number(n("apiKeys")) > 0
      ? `${n("apiKeys")} API keys + webhooks`
      : null,
    // "Courier integrations" was listed here for Scale only, but the
    // courierIntegrations entitlement is never checked anywhere — every plan
    // could already record a delivery — and there are no courier integrations:
    // the seller books their own rider and records who it was. Recording that
    // is basic order management, so it is not a plan differentiator.
    n("discovery") === true ? "Discovery listing" : null,
  ];
  return bullets.filter((bullet): bullet is string => Boolean(bullet));
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; payment?: string }>;
}) {
  const feedback = await searchParams;
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [{ data: plans }, { data: subscription, error: subscriptionError }, plan] = await Promise.all([
    supabase
      .from("plans")
      .select("code,name,entitlements,plan_prices(id,country,currency,interval,amount_minor,active)")
      .eq("active", true)
      .in("code", ["free", "growth", "scale"]),
    supabase
      .from("seller_subscriptions")
      .select(
        "state,current_period_end,grace_ends_at,cancelled_at,pending_change_type,plans!plan_id(code,name),pending_plan:plans!pending_plan_id(name),plan_prices!price_id(interval)",
      )
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    getSellerPlan(actor.sellerAccountId),
  ]);
  if (subscriptionError) {
    console.error("[BillingPage] seller_subscriptions query failed", subscriptionError);
  }

  const ordered = ["free", "growth", "scale"]
    .map((code) => (plans as PlanRow[] | null)?.find((row) => row.code === code))
    .filter((row): row is PlanRow => Boolean(row));
  const subscribedPlan = subscription?.plans as { code?: string; name?: string } | null;
  const renewsAt = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const pendingPlanRow = subscription?.pending_plan as { name?: string } | { name?: string }[] | null;
  const pendingPlanName = Array.isArray(pendingPlanRow) ? pendingPlanRow[0]?.name : pendingPlanRow?.name;
  const currentPriceRow = subscription?.plan_prices as { interval?: string } | { interval?: string }[] | null;
  const currentInterval =
    (Array.isArray(currentPriceRow) ? currentPriceRow[0]?.interval : currentPriceRow?.interval) ?? "monthly";
  const isPendingUpgrade = subscription?.pending_change_type === "upgrade";
  const pendingLabel =
    !isPendingUpgrade && subscription?.pending_change_type && renewsAt
      ? subscription.pending_change_type === "cancel"
        ? `Switching to Free on ${renewsAt}`
        : `Switching to ${pendingPlanName ?? "a different plan"} on ${renewsAt}`
      : null;

  const isEntitled = plan.state === "active" || plan.state === "grace";

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        eyebrow="Settings"
        title="Plan & billing"
        sub="Pick the plan that matches how you sell. Prices are set for your country and billed through Paystack — upgrade any time; downgrades and cancellations take effect at the end of your paid period."
      />

      <div className="grid gap-4">
        <Suspense fallback={null}>
          <SubscriptionVerifier />
        </Suspense>

        {feedback.error ? (
          <div
            className="rounded-[12px] border border-[#F2C9BF] bg-[#FBEAE7] px-4 py-3 text-[13px] font-semibold text-[#B42318]"
            role="alert"
          >
            {feedback.error}
          </div>
        ) : null}
        {feedback.payment === "confirmed" ? (
          <div
            className="rounded-[12px] border border-[#BFE3D2] bg-[#E7F4EE] px-4 py-3 text-[13px] font-semibold text-success"
            role="status"
          >
            Payment confirmed — your plan is active. Welcome aboard!
          </div>
        ) : null}

        {isPendingUpgrade ? (
          <Panel className="p-4.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[13.5px] font-bold text-ink">
                  Upgrade to {pendingPlanName ?? "a higher plan"} is waiting for payment
                </p>
                <p className="mt-1 max-w-[52ch] text-[12.5px] leading-[1.6] text-ink-soft">
                  You are still on {plan.planName} and nothing has changed yet. Choose the
                  plan again to finish paying, or discard the upgrade.
                </p>
              </div>
              <form action={cancelPendingUpgrade}>
                <SubmitButton
                  className="min-h-10 cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-ink-soft transition-colors hover:border-[#B9AC98] hover:text-ink disabled:cursor-wait disabled:opacity-60"
                  pendingLabel="Discarding…"
                >
                  Discard upgrade
                </SubmitButton>
              </form>
            </div>
          </Panel>
        ) : null}

        {/* Current plan */}
        <Panel className="p-4.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                Current plan
              </p>
              <div className="mt-1 flex items-center gap-2">
                <h2 className="font-serif text-[22px] font-medium text-ink">{plan.planName}</h2>
                <Badge tone={STATE_TONE[plan.state] ?? "neutral"}>
                  {plan.state === "free" ? "Free" : plan.state.replace("_", " ")}
                </Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-soft">
                {plan.state === "free"
                  ? "Core selling is always free — storefront, Paystack payments, orders and share links."
                  : renewsAt
                    ? `Renews on ${renewsAt}.`
                    : "Billing is managed by Paystack."}
              </p>
              {plan.graceEndsAt ? (
                <p className="mt-1 text-[12.5px] font-semibold text-warn">
                  Payment issue — features stay on until{" "}
                  {new Date(plan.graceEndsAt).toLocaleDateString()} while we retry.
                </p>
              ) : null}
              {subscription && plan.state === "free" && subscribedPlan?.name ? (
                <p className="mt-1 text-[12.5px] text-ink-muted">
                  Your {subscribedPlan.name} subscription is {subscription.state.replace("_", " ")} —
                  resubscribe below to restore its features.
                </p>
              ) : null}
              {pendingLabel ? (
                <p className="mt-1 text-[12.5px] font-semibold text-ink-muted">{pendingLabel}</p>
              ) : null}
            </div>
            {isEntitled && !subscription?.pending_change_type ? (
              <form action={cancelSubscription}>
                <SubmitButton
                  className="min-h-10 cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-danger transition-colors hover:border-danger disabled:cursor-wait disabled:opacity-60"
                  pendingLabel="Cancelling…"
                >
                  Cancel renewal
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </Panel>

        {/* Plan cards */}
        <div className="grid items-start gap-4 md:grid-cols-3">
          {ordered.map((row) => {
            const isCurrent = plan.planCode === row.code;
            const prices = row.plan_prices.filter(
              (price) => price.country === actor.country && price.active && price.amount_minor > 0,
            );
            const monthly = prices.find((price) => price.interval === "monthly");
            const yearly = prices.find((price) => price.interval === "yearly");
            const featured = row.code === "growth";
            const isUpgradeTarget = row.code !== "free" && (!isEntitled || TIER[row.code] > TIER[plan.planCode]);
            const isPendingThisRow =
              row.code === "free"
                ? subscription?.pending_change_type === "cancel"
                : subscription?.pending_change_type === "downgrade" && pendingPlanName === row.name;
            return (
              <Panel
                key={row.code}
                className={`p-4.5 ${featured ? "border-accent shadow-[0_10px_30px_rgba(168,67,26,0.08)]" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-serif text-[19px] font-medium text-ink">{row.name}</h3>
                  {isCurrent ? (
                    <Badge tone="accent">Current</Badge>
                  ) : featured ? (
                    <Badge tone="dark">Popular</Badge>
                  ) : null}
                </div>

                <p className="mt-2 min-h-[42px]">
                  {row.code === "free" ? (
                    <span className="font-serif text-[24px] font-medium text-ink">Free</span>
                  ) : monthly ? (
                    <>
                      <span className="font-serif text-[24px] font-medium text-ink">
                        {formatMoney(monthly.amount_minor, monthly.currency as CurrencyCode)}
                      </span>
                      <span className="text-[12.5px] text-ink-muted"> / month</span>
                      {yearly ? (
                        <span className="block text-[11.5px] text-ink-muted">
                          or {formatMoney(yearly.amount_minor, yearly.currency as CurrencyCode)} / year
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-[13px] font-semibold text-warn">
                      Not priced for your country yet
                    </span>
                  )}
                </p>

                <ul className="mt-3 grid list-none gap-1.5 p-0">
                  {featureBullets(row.entitlements).map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2 text-[12.5px] text-ink-soft">
                      <span aria-hidden="true" className="mt-0.5 font-bold text-success">
                        ✓
                      </span>
                      {bullet}
                    </li>
                  ))}
                </ul>

                <div className="mt-4">
                  {isCurrent ? (
                    // A seller on monthly could not previously reach yearly at
                    // all — "Your plan" was a dead end on the only card that
                    // could offer it.
                    isEntitled && row.code !== "free" && monthly && yearly ? (
                      <form action={changePlan} className="grid gap-2">
                        <input name="planCode" type="hidden" value={row.code} />
                        <input
                          name="interval"
                          type="hidden"
                          value={currentInterval === "yearly" ? "monthly" : "yearly"}
                        />
                        <p className="text-center text-[12px] text-ink-muted">
                          Billed {currentInterval}
                        </p>
                        <SubmitButton
                          className="min-h-11 w-full cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-ink transition-colors hover:border-[#B9AC98] disabled:cursor-wait disabled:opacity-60"
                          pendingLabel={currentInterval === "yearly" ? "Switching…" : "Redirecting to payment…"}
                        >
                          {currentInterval === "yearly"
                            ? `Switch to monthly — takes effect ${renewsAt ?? "at period end"}`
                            : `Switch to yearly — save ${formatMoney(monthly.amount_minor * 12 - yearly.amount_minor, yearly.currency as CurrencyCode)}`}
                        </SubmitButton>
                      </form>
                    ) : (
                      <p className="grid min-h-11 place-items-center rounded-[10px] bg-line-soft text-[13px] font-bold text-ink-muted">
                        Your plan
                      </p>
                    )
                  ) : isPendingThisRow ? (
                    <p className="text-[12px] text-ink-muted">{pendingLabel}</p>
                  ) : row.code === "free" ? (
                    isEntitled ? (
                      <form action={changePlan}>
                        <input name="planCode" type="hidden" value="free" />
                        <SubmitButton
                          className="min-h-11 w-full cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13.5px] font-bold text-ink transition-colors hover:border-[#B9AC98] disabled:cursor-wait disabled:opacity-60"
                          pendingLabel="Switching…"
                        >
                          Switch to Free — takes effect {renewsAt ?? "at period end"}
                        </SubmitButton>
                      </form>
                    ) : (
                      <p className="text-[12px] text-ink-muted">Free is always available — no billing required.</p>
                    )
                  ) : prices.length > 0 ? (
                    <form action={changePlan} className="grid gap-2.5">
                      <input name="planCode" type="hidden" value={row.code} />
                      {isUpgradeTarget ? (
                        <label className="grid gap-1 text-[12px] font-semibold text-ink-soft">
                          Billing interval
                          <select
                            name="interval"
                            className="min-h-10 rounded-[10px] border border-line-input bg-white px-3 text-[13px] text-ink"
                            defaultValue="monthly"
                          >
                            <option value="monthly">Monthly</option>
                            {yearly ? <option value="yearly">Yearly (2 months free)</option> : null}
                          </select>
                        </label>
                      ) : null}
                      <SubmitButton
                        className={`min-h-11 cursor-pointer rounded-[10px] px-4 text-[13.5px] font-bold transition-colors disabled:cursor-wait disabled:opacity-60 ${
                          featured
                            ? "border-none bg-accent text-white hover:bg-accent-deep"
                            : "border border-line-strong bg-white text-ink hover:border-[#B9AC98]"
                        }`}
                        pendingLabel={isUpgradeTarget ? "Redirecting to payment…" : "Switching…"}
                      >
                        {isUpgradeTarget ? `Upgrade to ${row.name}` : `Switch to ${row.name} — takes effect ${renewsAt ?? "at period end"}`}
                      </SubmitButton>
                    </form>
                  ) : (
                    <p className="grid min-h-11 place-items-center rounded-[10px] bg-line-soft text-[13px] font-bold text-ink-muted">
                      Coming to your market soon
                    </p>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>

        <p className="text-[12px] text-ink-muted">
          Payments are processed by Paystack. Upgrades take effect immediately after payment;
          downgrades and cancellations keep your current features until the end of the paid period.
          Manage plan pricing questions with{" "}
          <Link
            href="/dashboard/orders"
            className="font-semibold text-accent no-underline hover:text-accent-deep"
          >
            support
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
