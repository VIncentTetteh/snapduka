import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

/** This page reports all time. */
const EPOCH = "1970-01-01T00:00:00Z";

export default async function ProfitPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  // Aggregated by seller_product_profit, which has existed since 202608070069
  // and which only the mobile app ever used. The web page pulled every paid
  // order line the seller had ever sold and grouped them in JavaScript, so past
  // db.max_rows every revenue, cost and margin figure here was computed from a
  // truncated set. The RPC orders by revenue, so what survives the response cap
  // is the products that matter rather than an arbitrary thousand.
  const [{ data: shop }, { data: rows }] = await Promise.all([
    supabase.from("shops").select("currency").eq("seller_account_id", actor.sellerAccountId).single(),
    supabase.rpc("seller_product_profit", { p_from: EPOCH, p_to: new Date().toISOString() }),
  ]);
  const currency = (shop?.currency ?? "GHS") as CurrencyCode;
  const summaries = (rows ?? [])
    .map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      unitsSold: Number(row.units_sold),
      revenueMinor: Number(row.revenue_minor),
      // Null, not zero: a product whose cost was never entered has unknown
      // profit, and reporting zero margin would be a confident wrong answer.
      costMinor: row.cost_minor == null ? null : Number(row.cost_minor),
      profitMinor: row.profit_minor == null ? null : Number(row.profit_minor),
    }))
    .sort((a, b) => (b.profitMinor ?? -Infinity) - (a.profitMinor ?? -Infinity));

  return (
    <main className="mx-auto grid w-full max-w-4xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Growth</p>
        <h1 className="page-title mt-1">Profit</h1>
        <p className="page-sub">Revenue and cost from paid orders. Set your cost on each product to unlock this.</p>
      </header>

      {summaries.length === 0 ? (
        <div className="card">
          <p className="m-0 text-sm" style={{ color: "var(--ink-2)" }}>No paid sales yet.</p>
        </div>
      ) : (
        <section className="card grid gap-2">
          {summaries.map((row) => {
            const margin = row.profitMinor != null && row.revenueMinor > 0 ? Math.round((row.profitMinor / row.revenueMinor) * 100) : null;
            return (
              <div className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0" key={row.productId} style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0">
                  <p className="m-0 truncate font-semibold" style={{ color: "var(--ink)" }}>{row.productName}</p>
                  <p className="m-0 text-xs" style={{ color: "var(--ink-3)" }}>{row.unitsSold} sold · {formatMoney(row.revenueMinor, currency)} revenue</p>
                </div>
                <div className="text-right">
                  <p className="m-0 font-bold" style={{ color: "var(--ink)" }}>
                    {row.profitMinor == null ? "Unknown" : formatMoney(row.profitMinor, currency)}
                  </p>
                  {margin != null ? <p className="m-0 text-xs" style={{ color: "var(--ink-3)" }}>{margin}% margin</p> : null}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}
