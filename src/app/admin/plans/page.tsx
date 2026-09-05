import {
  syncPlatformFeeAction,
  updatePlanPriceAction,
  updatePlatformFeeAction,
} from "@/app/admin/actions";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/surface";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/i18n";
import { formatFeeBps } from "@/lib/payments/platform-fee";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  const admin = createAdminClient();
  const [{ data: plans }, { data: prices }, { data: subscriptions }, { data: countries }, { data: subaccounts }] = await Promise.all([
    admin.from("plans").select("id,code,name,version,active").eq("active", true).order("code"),
    admin
      .from("plan_prices")
      .select("id,plan_id,country,currency,interval,amount_minor,active")
      .eq("active", true)
      .order("country"),
    // Counted in SQL: this pulled one row per subscription on the platform to
    // produce a count per plan.
    admin.rpc("admin_plan_subscription_counts"),
    admin.from("country_configs").select("country,currency,platform_fee_bps").order("country"),
    // Likewise: every active Paystack subaccount was fetched to count how many
    // carry a stale fee. Whether an operator sees "nobody is on the new fee
    // yet" cannot depend on how many subaccounts exist.
    admin.rpc("admin_subaccount_fee_drift"),
  ]);

  // A fee change only reaches sellers who onboard afterwards — Paystack holds
  // percentage_charge on the subaccount. Counting the drift is what makes "you
  // changed the number but nobody is on it yet" visible; admin_subaccount_fee_drift
  // does the join and the comparison in SQL.
  const driftByCountry = (countries ?? []).reduce<Record<string, { total: number; stale: number }>>(
    (acc, config) => {
      const row = (subaccounts ?? []).find((entry) => entry.country === config.country);
      acc[config.country] = {
        total: Number(row?.total ?? 0),
        stale: Number(row?.stale ?? 0),
      };
      return acc;
    },
    {},
  );

  const sellersByPlan = (subscriptions ?? []).reduce<Record<string, number>>((acc, sub) => {
    acc[sub.plan_id] = (acc[sub.plan_id] ?? 0) + Number(sub.subscriptions);
    return acc;
  }, {});

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Plans & fees"
        sub="Per-market pricing. Every change requires a reason and is recorded in the audit log."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Free plan (implicit) */}
        <Panel className="p-4.5">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-bold text-ink">Free</h2>
            <Badge tone="neutral">Default</Badge>
          </div>
          <p className="mb-3 text-[12.5px] text-ink-soft">
            Every seller starts here — storefront, Paystack payments, guest checkout and basic
            order management.
          </p>
          <p className="font-serif text-[20px] font-medium text-ink">Free to start</p>
        </Panel>

        {(plans ?? []).map((plan) => {
          const planPrices = (prices ?? []).filter((price) => price.plan_id === plan.id);
          const sellerCount = sellersByPlan[plan.id] ?? 0;
          return (
            <Panel key={plan.id} className="p-4.5">
              <div className="mb-1 flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-bold text-ink">{plan.name}</h2>
                <Badge tone="accent">v{plan.version}</Badge>
              </div>
              <p className="mb-3 text-[12.5px] text-ink-soft">
                {sellerCount} {sellerCount === 1 ? "seller" : "sellers"} subscribed
              </p>
              <div className="grid gap-2.5">
                {planPrices.length === 0 ? (
                  <p className="text-[12.5px] text-ink-muted">No pricing configured.</p>
                ) : (
                  planPrices.map((price) => (
                    <details key={price.id} className="rounded-[10px] border border-line bg-raised">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
                        <span className="text-[13px] font-semibold text-ink">
                          {price.country} · {price.interval}
                        </span>
                        <span className="text-[13px] font-bold text-ink">
                          {formatMoney(price.amount_minor, price.currency as CurrencyCode)}
                        </span>
                      </summary>
                      <form
                        action={updatePlanPriceAction}
                        className="grid gap-2.5 border-t border-line px-3.5 py-3"
                      >
                        <input name="priceId" type="hidden" value={price.id} />
                        <label
                          className="grid gap-1 text-[12px] font-semibold text-ink"
                          htmlFor={`amount-${price.id}`}
                        >
                          New amount ({price.currency} minor units)
                          <input
                            id={`amount-${price.id}`}
                            name="amountMinor"
                            inputMode="numeric"
                            defaultValue={price.amount_minor}
                            className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none focus:border-accent"
                          />
                        </label>
                        <label
                          className="grid gap-1 text-[12px] font-semibold text-ink"
                          htmlFor={`reason-${price.id}`}
                        >
                          Reason (required)
                          <input
                            id={`reason-${price.id}`}
                            name="reason"
                            required
                            placeholder="e.g. Annual market pricing review"
                            className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                          />
                        </label>
                        <SubmitButton
                          className="min-h-9 cursor-pointer justify-self-start rounded-[9px] border-none bg-ink px-3.5 text-[12.5px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
                          pendingLabel="Saving…"
                        >
                          Save price
                        </SubmitButton>
                      </form>
                    </details>
                  ))
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <PageHeader
        title="Platform fee"
        sub="SnapDuka's share of each online sale. The seller's Paystack subaccount receives the rest, and Paystack's own processing fee comes out of SnapDuka's share — not the seller's."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {(countries ?? []).map((config) => {
          const drift = driftByCountry[config.country] ?? { total: 0, stale: 0 };
          return (
            <Panel key={config.country} className="p-4.5">
              <div className="mb-1 flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-bold text-ink">
                  {config.country} · {config.currency}
                </h2>
                <Badge tone="accent">{formatFeeBps(config.platform_fee_bps)}</Badge>
              </div>
              <p className="mb-3 text-[12.5px] text-ink-soft">
                Sellers keep {formatFeeBps(10_000 - config.platform_fee_bps)} of every online sale.
              </p>

              <form action={updatePlatformFeeAction} className="grid gap-2.5">
                <input name="country" type="hidden" value={config.country} />
                <label
                  className="grid gap-1 text-[12px] font-semibold text-ink"
                  htmlFor={`fee-${config.country}`}
                >
                  New fee (%)
                  <input
                    id={`fee-${config.country}`}
                    name="feePercent"
                    inputMode="decimal"
                    defaultValue={config.platform_fee_bps / 100}
                    className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none focus:border-accent"
                  />
                </label>
                <label
                  className="grid gap-1 text-[12px] font-semibold text-ink"
                  htmlFor={`fee-reason-${config.country}`}
                >
                  Reason (required)
                  <input
                    id={`fee-reason-${config.country}`}
                    name="reason"
                    required
                    placeholder="e.g. Lowered to 7% to stay competitive"
                    className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                  />
                </label>
                <SubmitButton
                  className="min-h-9 cursor-pointer justify-self-start rounded-[9px] border-none bg-ink px-3.5 text-[12.5px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
                  pendingLabel="Saving…"
                >
                  Save fee
                </SubmitButton>
              </form>

              {drift.stale > 0 ? (
                <form
                  action={syncPlatformFeeAction}
                  className="mt-3 grid gap-2 border-t border-line pt-3"
                >
                  <input name="country" type="hidden" value={config.country} />
                  <input name="confirm" type="hidden" value="yes" />
                  <p className="text-[12px] leading-[1.5] text-ink-soft">
                    <strong className="text-ink">
                      {drift.stale} of {drift.total}
                    </strong>{" "}
                    {drift.stale === 1 ? "seller is" : "sellers are"} still on an older rate at
                    Paystack. Changing the number above does not move them — Paystack stores it on
                    each subaccount.
                  </p>
                  <SubmitButton
                    className="min-h-9 cursor-pointer justify-self-start rounded-[9px] border border-line bg-raised px-3.5 text-[12.5px] font-bold text-ink transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-60"
                    pendingLabel="Syncing…"
                  >
                    Apply to existing sellers
                  </SubmitButton>
                </form>
              ) : drift.total > 0 ? (
                <p className="mt-3 border-t border-line pt-3 text-[12px] text-ink-muted">
                  All {drift.total} {drift.total === 1 ? "seller is" : "sellers are"} on this rate.
                </p>
              ) : null}
            </Panel>
          );
        })}
      </div>
    </main>
  );
}
