import { productProfitSummaries } from "@/lib/analytics/advanced";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

export default async function ProfitPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [{ data: shop }, { data: orderLines }] = await Promise.all([
    supabase.from("shops").select("currency").eq("seller_account_id", actor.sellerAccountId).single(),
    supabase
      .from("order_lines")
      .select("product_id,product_name,quantity,line_total_minor,unit_cost_minor,orders!inner(seller_account_id,payment_status)")
      .eq("orders.seller_account_id", actor.sellerAccountId)
      .eq("orders.payment_status", "paid"),
  ]);
  const currency = (shop?.currency ?? "GHS") as CurrencyCode;
  const summaries = productProfitSummaries(
    (orderLines ?? []).map((line) => ({
      productId: line.product_id,
      productName: line.product_name,
      quantity: line.quantity,
      lineTotalMinor: line.line_total_minor,
      unitCostMinor: line.unit_cost_minor,
    })),
  ).sort((a, b) => (b.profitMinor ?? -Infinity) - (a.profitMinor ?? -Infinity));

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
