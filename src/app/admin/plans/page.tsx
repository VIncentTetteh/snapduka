import { updatePlanPriceAction } from "@/app/admin/actions";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/surface";
import { formatMoney } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  const admin = createAdminClient();
  const [{ data: plans }, { data: prices }, { data: subscriptions }] = await Promise.all([
    admin.from("plans").select("id,code,name,version,active").eq("active", true).order("code"),
    admin
      .from("plan_prices")
      .select("id,plan_id,country,currency,interval,amount_minor,active")
      .eq("active", true)
      .order("country"),
    admin.from("seller_subscriptions").select("plan_id"),
  ]);

  const sellersByPlan = (subscriptions ?? []).reduce<Record<string, number>>((acc, sub) => {
    acc[sub.plan_id] = (acc[sub.plan_id] ?? 0) + 1;
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
                        <button
                          type="submit"
                          className="min-h-9 cursor-pointer justify-self-start rounded-[9px] border-none bg-ink px-3.5 text-[12.5px] font-bold text-white transition-colors hover:bg-ink-2"
                        >
                          Save price
                        </button>
                      </form>
                    </details>
                  ))
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </main>
  );
}
