import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

import { saveFulfillmentMethod, toggleFulfillmentMethod, updateFulfillmentFee } from "./actions";
import { formatMoney } from "@/lib/i18n";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

export default async function FulfillmentSettingsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") redirect("/login?next=/dashboard/settings/fulfillment");
  const supabase = await createClient();
  const [{ data: methods }, { data: shop }] = await Promise.all([
    supabase
      .from("fulfillment_methods")
      .select("id, type, name, fee_minor, instructions, active")
      .eq("seller_account_id", actor.sellerAccountId)
      .order("position"),
    supabase
      .from("shops")
      .select("currency")
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
  ]);
  const currency = (shop?.currency ?? "GHS") as CurrencyCode;

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Seller settings</p>
        <h1 className="page-title mt-1">Delivery and pickup</h1>
        <p className="page-sub">
          Set the fee buyers pay per method — it covers however you deliver (your own rider,
          Bolt/Yango booking, or a courier for interstate). Fees are in minor units: 2500 = {formatMoney(2500, currency)}.
        </p>
      </header>

      <form action={saveFulfillmentMethod} className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>
          Add a method
        </h2>
        <select className="field-input" name="type">
          <option value="delivery">Seller delivery</option>
          <option value="pickup">Buyer pickup</option>
        </select>
        <input aria-required="true" className="field-input" minLength={2} name="name" placeholder="Method name, e.g. Accra delivery *" required />
        <input aria-required="true" className="field-input" inputMode="numeric" name="feeMinor" pattern="[0-9]+" title="Whole number in minor units (0 = free)" placeholder="Fee in minor units (0 = free) *" required />
        <textarea className="field-input" name="instructions" placeholder="Areas, timing, or pickup directions (optional)" rows={3} />
        <button className="btn-primary w-full" type="submit">Add method</button>
      </form>

      <section className="grid gap-3">
        <h2 className="m-0 text-xl font-extrabold" style={{ color: "var(--ink)" }}>
          Available methods
        </h2>
        {!methods?.length && (
          <div
            className="rounded-2xl p-8 text-center"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <p className="m-0 text-sm" style={{ color: "var(--ink-2)" }}>
              No fulfillment methods yet — add one above.
            </p>
          </div>
        )}
        {methods?.map((method) => (
          <article className="card grid gap-3" key={method.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="m-0 font-extrabold" style={{ color: "var(--ink)" }}>{method.name}</p>
                <p className="m-0 mt-0.5 text-sm capitalize" style={{ color: "var(--ink-2)" }}>
                  {method.type} · {method.fee_minor > 0 ? formatMoney(method.fee_minor, currency) : "Free"}
                </p>
                {method.instructions && (
                  <p className="m-0 mt-1 text-sm" style={{ color: "var(--ink-3)" }}>{method.instructions}</p>
                )}
              </div>
              <span className={`badge ${method.active ? "badge-green" : "badge-stone"}`}>
                {method.active ? "Active" : "Inactive"}
              </span>
            </div>
            <form action={updateFulfillmentFee} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input name="methodId" type="hidden" value={method.id} />
              <input
                aria-label={`Name for ${method.name}`}
                className="field-input"
                defaultValue={method.name}
                minLength={2}
                name="name"
                required
              />
              <input
                aria-label={`Fee for ${method.name} in minor units`}
                className="field-input"
                defaultValue={method.fee_minor}
                inputMode="numeric"
                name="feeMinor"
                pattern="[0-9]+"
                placeholder="Fee in minor units"
                required
                title="Whole number in minor units (0 = free)"
              />
              <button className="btn-secondary" type="submit">Save</button>
            </form>
            <form action={toggleFulfillmentMethod}>
              <input name="methodId" type="hidden" value={method.id} />
              <input name="active" type="hidden" value={method.active ? "false" : "true"} />
              <button className={method.active ? "btn-danger" : "btn-secondary"} type="submit">
                {method.active ? "Deactivate" : "Activate"}
              </button>
            </form>
          </article>
        ))}
      </section>
    </main>
  );
}
