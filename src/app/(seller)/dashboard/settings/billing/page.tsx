import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

import { cancelSubscription, selectPlan } from "./actions";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ error?: string; payment?: string }> }) {
  const feedback = await searchParams;
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [{ data: plans }, { data: subscription }] = await Promise.all([
    supabase.from("plans").select("code,name,version,entitlements,plan_prices(id,country,currency,interval,amount_minor,provider_plan_code,active)").in("code", ["growth", "scale"]).eq("active", true),
    supabase
      .from("seller_subscriptions")
      .select("state,current_period_end,grace_ends_at,plans(name)")
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
  ]);

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Settings</p>
        <h1 className="page-title mt-1">Plan and billing</h1>
        <p className="page-sub">
          Plan prices are configured per country. Payment processing and SnapDuka platform fees are shown separately before charge authorization.
        </p>
      </header>

      {feedback.error && <div className="alert alert-error" role="alert">{feedback.error}</div>}
      {feedback.payment === "pending" && <div className="alert alert-info" role="status">Payment received by Paystack. Your plan will activate when the signed webhook is processed.</div>}

      {subscription && (
        <section className="card">
          <h2 className="m-0 mb-2 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Current subscription</h2>
          <p className="m-0 capitalize" style={{ color: "var(--ink-2)" }}>{subscription.state.replace("_", " ")}</p>
          {subscription.grace_ends_at && (
            <p className="m-0 mt-1 text-sm" style={{ color: "var(--amber)" }}>
              Recovery deadline: {new Date(subscription.grace_ends_at).toLocaleDateString()}
            </p>
          )}
          <form action={cancelSubscription} className="mt-3">
            <button className="btn-danger text-sm" type="submit">Cancel renewal</button>
          </form>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        {(plans ?? []).map((plan) => {
          const prices = (plan.plan_prices ?? []).filter((price) => price.country === actor.country && price.active);
          const configured = prices.some((price) => Boolean(price.provider_plan_code) && price.amount_minor > 0);
          return (
          <article className="card" key={plan.code}>
            <h2 className="m-0 mb-1 text-lg font-extrabold" style={{ color: "var(--ink)" }}>{plan.name}</h2>
            <p className="m-0 mb-3 text-sm" style={{ color: "var(--ink-2)" }}>
              Products, campaigns, branding and operating limits are controlled by this versioned plan.
            </p>
            {prices.length > 0 ? (
              <ul className="m-0 mb-3 grid gap-1 pl-5 text-sm" style={{ color: "var(--ink-2)" }}>
                {prices.map((price) => <li key={price.id}>{price.interval}: {price.currency} {price.currency === "XOF" ? price.amount_minor : (price.amount_minor / 100).toFixed(2)}</li>)}
              </ul>
            ) : <p className="alert alert-warning">Pricing is not available for your country yet.</p>}
            <form action={selectPlan} className="grid gap-3">
              <input name="planCode" type="hidden" value={plan.code} />
              <div className="grid gap-1">
                <label className="field-label" htmlFor={`interval-${plan.code}`}>Billing interval</label>
                <select className="field-input" id={`interval-${plan.code}`} name="interval">
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <button className="btn-primary w-full" disabled={!configured} type="submit">{configured ? "Continue to Paystack" : "Not available"}</button>
            </form>
          </article>
        );})}
      </section>
    </main>
  );
}
