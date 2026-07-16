import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

import { createPromotion } from "./actions";

export default async function PromotionsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("promotions")
    .select("id,name,code,kind,value,active")
    .eq("seller_account_id", actor.sellerAccountId)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Growth</p>
        <h1 className="page-title mt-1">Promotions</h1>
        <p className="page-sub">Discounts are validated again at checkout and snapshotted on the order.</p>
      </header>

      <form action={createPromotion} className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>New promotion</h2>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="promo-name">Name</label>
          <input className="field-input" id="promo-name" name="name" placeholder="Launch offer" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="promo-code">Code</label>
          <input className="field-input uppercase" id="promo-code" name="code" placeholder="LAUNCH20" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="promo-kind">Type</label>
          <select className="field-input" id="promo-kind" name="kind">
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed amount (minor units)</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="promo-value">Value</label>
          <input className="field-input" id="promo-value" min="1" name="value" placeholder="20" type="number" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="promo-min">Minimum order (optional)</label>
          <input className="field-input" id="promo-min" min="0" name="minimumMinor" placeholder="Minimum order" type="number" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="promo-limit">Total uses limit (optional)</label>
          <input className="field-input" id="promo-limit" min="0" name="redemptionLimit" placeholder="Blank = unlimited" type="number" />
        </div>
        <button className="btn-primary w-full" type="submit">Create promotion</button>
      </form>

      {items?.map((item) => (
        <article className="card" key={item.id}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="m-0 font-extrabold" style={{ color: "var(--ink)" }}>{item.name}</p>
              <p className="m-0 mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
                {item.code} · {item.value}{item.kind === "percentage" ? "%" : " minor units"}
              </p>
            </div>
            <span className={`badge ${item.active ? "badge-green" : "badge-stone"}`}>
              {item.active ? "Active" : "Paused"}
            </span>
          </div>
        </article>
      ))}
    </main>
  );
}
