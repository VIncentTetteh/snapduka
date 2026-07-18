import { UpgradePrompt } from "@/components/seller/upgrade-prompt";
import { resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan, planLimit } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";

import { createSegment } from "./actions";

export default async function SegmentsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [{ data }, plan] = await Promise.all([
    supabase
      .from("customer_segments")
      .select("id,name,rules")
      .eq("seller_account_id", actor.sellerAccountId),
    getSellerPlan(actor.sellerAccountId),
  ]);
  const segmentLimit = planLimit(plan, "customerSegments");
  const atLimit = (data?.length ?? 0) >= segmentLimit;

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Growth</p>
        <h1 className="page-title mt-1">Customer segments</h1>
        <p className="page-sub">Segments use seller-scoped aggregate order data only.</p>
      </header>

      {atLimit ? (
        <UpgradePrompt
          feature="Customer segments"
          planName={plan.planName}
          detail={
            segmentLimit === 0
              ? undefined
              : `You've used ${data?.length ?? 0} of ${segmentLimit} segments on your ${plan.planName} plan.`
          }
        />
      ) : (
      <form action={createSegment} className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>New segment</h2>
        <p className="m-0 text-xs" style={{ color: "var(--ink-3)" }}>{data?.length ?? 0} of {segmentLimit} segments used.</p>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="seg-name">Name</label>
          <input className="field-input" id="seg-name" name="name" placeholder="Repeat buyers" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="seg-orders">Minimum orders</label>
          <input className="field-input" id="seg-orders" min="0" name="minimumOrders" placeholder="Minimum orders" type="number" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="seg-spend">Minimum spend (minor units)</label>
          <input className="field-input" id="seg-spend" min="0" name="minimumSpendMinor" placeholder="Minimum spend" type="number" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="seg-days">Ordered within N days</label>
          <input className="field-input" id="seg-days" min="1" name="orderedWithinDays" placeholder="Ordered within days" type="number" />
        </div>
        <button className="btn-primary w-full" type="submit">Create segment</button>
      </form>
      )}

      {data?.map((item) => (
        <article className="card" key={item.id}>
          <p className="m-0 font-extrabold" style={{ color: "var(--ink)" }}>{item.name}</p>
          <pre
            className="mt-2 overflow-auto rounded-lg px-3 py-2 text-xs"
            style={{ background: "var(--accent-lite)", color: "var(--accent)" }}
          >
            {JSON.stringify(item.rules, null, 2)}
          </pre>
        </article>
      ))}
    </main>
  );
}
