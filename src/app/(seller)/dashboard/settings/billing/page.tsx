import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

import { cancelSubscription, selectPlan } from "./actions";

export default async function BillingPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [{ data: plans }, { data: subscription }] = await Promise.all([
    supabase.from("plans").select("code,name,version,entitlements").in("code", ["growth", "scale"]).eq("active", true),
    supabase.from("seller_subscriptions").select("state,current_period_end,grace_ends_at,plans(name)").eq("seller_account_id", actor.sellerAccountId).maybeSingle(),
  ]);

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-24">
      <header><p className="font-bold uppercase tracking-wide text-emerald-900">Settings</p><h1 className="m-0 text-4xl font-black">Plan and billing</h1><p>Plan prices are configured per country. Payment processing and SnapDuka platform fees are shown separately before charge authorization.</p></header>
      {subscription && <section className="rounded-3xl border bg-white p-5"><h2 className="m-0">Current subscription</h2><p className="capitalize">{subscription.state.replace("_", " ")}</p>{subscription.grace_ends_at && <p>Recovery deadline: {new Date(subscription.grace_ends_at).toLocaleDateString()}</p>}<form action={cancelSubscription}><button className="secondaryAction" type="submit">Cancel renewal</button></form></section>}
      <section className="grid gap-3 sm:grid-cols-2">
        {(plans ?? []).map((plan) => <article className="rounded-3xl border bg-white p-5" key={plan.code}><h2>{plan.name}</h2><p>Products, campaigns, branding and operating limits are controlled by this versioned plan.</p><form action={selectPlan} className="grid gap-3"><input name="planCode" type="hidden" value={plan.code}/><label>Billing interval<select className="min-h-12 rounded-xl border px-3" name="interval"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label><button className="primaryAction" type="submit">Start plan</button></form></article>)}
      </section>
    </main>
  );
}
