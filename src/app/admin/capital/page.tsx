import { cancelAdvanceAction, closeAdvanceAction, recordPartnerSettlementAction } from "@/app/admin/capital/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { requireOperator } from "@/lib/auth/require-operator";
import { formatBps } from "@/lib/financing/terms";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@snapduka/core";

export const dynamic = "force-dynamic";

const ADVANCE_LIMIT = 100;

const STATE_TONE: Record<string, BadgeTone> = {
  accepted: "warn",
  disbursed: "accent",
  repaying: "accent",
  repaid: "success",
  cancelled: "neutral",
  defaulted: "danger",
  written_off: "neutral",
};

const INPUT = "h-9 rounded-[8px] border border-line-input bg-white px-2.5 text-[12.5px]";
const BUTTON = "min-h-9 cursor-pointer rounded-[8px] border-none bg-ink px-3.5 text-[12.5px] font-bold text-white";

/**
 * Stock financing, operator view (ADR-0014): market policies, recent advances,
 * what is owed to lending partners and whether the product tables agree with
 * the ledger. Every read is service-role, hence the handler's own operator
 * check; every write goes through actions.ts, which audits it.
 */
export default async function AdminCapitalPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireOperator("/admin/capital");
  const flash = await searchParams;
  const admin = createAdminClient();

  const [policies, advances, due, invariants] = await Promise.all([
    admin
      .from("financing_policies")
      .select("country,enabled,partner,min_gmv_90d_minor,min_orders_90d,min_offer_minor,max_offer_minor,fee_bps,sweep_bps,terms_version")
      .order("country"),
    // Bounded: db.max_rows would truncate an unbounded select without saying so.
    admin
      .from("financing_advances")
      .select(
        "id,seller_account_id,state,currency,partner,partner_reference,principal_minor,swept_minor,remitted_minor,fee_revenue_minor,total_repayable_minor,accepted_at,state_reason",
      )
      .order("created_at", { ascending: false })
      .limit(ADVANCE_LIMIT),
    admin.rpc("financing_partner_amounts_due"),
    admin.rpc("check_financial_product_invariants"),
  ]);
  const readError = [policies, advances, due, invariants].find((result) => result.error)?.error;

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Capital"
        sub="Stock financing funded by licensed lending partners. Every action here is written to the audit log."
      />

      {flash.error || readError ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-[13px] font-semibold text-danger"
        >
          {flash.error ?? `Could not load everything: ${readError?.message}`}
        </div>
      ) : null}
      {flash.saved ? (
        <div role="status" className="mb-4 rounded-xl bg-success-tint px-4 py-3 text-[13px] font-semibold text-success">
          {flash.saved}
        </div>
      ) : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel className="p-4.5">
          <h2 className="mb-2 text-[14px] font-bold">Books</h2>
          {invariants.data && invariants.data.length === 0 ? (
            <Badge tone="success">Books agree</Badge>
          ) : (
            <ul className="grid gap-1.5 text-[12.5px] text-danger">
              {(invariants.data ?? []).map((row) => (
                <li key={`${row.check_name}:${row.detail}`}>
                  <strong className="font-bold">{row.check_name}</strong> · {row.detail}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="p-4.5">
          <h2 className="mb-2 text-[14px] font-bold">Owed to partners</h2>
          {due.data?.length ? (
            <ul className="grid gap-1.5 text-[12.5px] text-ink-soft">
              {due.data.map((row) => (
                <li key={row.currency}>
                  <strong className="font-bold text-ink">{formatMoney(row.due_minor, row.currency)}</strong> to{" "}
                  {row.partner}
                  {row.partners > 1 ? ` (${row.partners} partners: settle by hand)` : ""} · remitted{" "}
                  {formatMoney(row.remitted_minor, row.currency)}, transferred{" "}
                  {formatMoney(row.transferred_minor, row.currency)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-soft">Nothing remitted yet.</p>
          )}
        </Panel>
      </div>

      <Panel className="mb-4 p-4.5">
        <h2 className="mb-1 text-[14px] font-bold">Record a partner settlement</h2>
        <p className="mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
          Only for cash the partner webhook and the daily settle job did not record themselves (those appear in the
          ledger as <code>partner:reference</code>). The reference is the dedupe key: recording one twice adds
          nothing, and the total can never exceed what is due in that direction.
        </p>
        <form action={recordPartnerSettlementAction} className="flex flex-wrap items-end gap-2.5">
          <select name="currency" required aria-label="Currency" className={INPUT} defaultValue="GHS">
            <option value="GHS">GHS</option>
            <option value="NGN">NGN</option>
            <option value="XOF">XOF</option>
          </select>
          <select name="direction" required aria-label="Direction" className={INPUT} defaultValue="from_partner">
            <option value="from_partner">Funding received from partner</option>
            <option value="to_partner">Repayments sent to partner</option>
          </select>
          <input name="amount" required inputMode="decimal" aria-label="Amount" placeholder="Amount (major units)" className={INPUT} />
          <input name="reference" required aria-label="Reference" placeholder="Bank / partner reference" className={INPUT} />
          <button className={BUTTON}>Record settlement</button>
        </form>
      </Panel>

      <Panel className="mb-4 overflow-x-auto p-4">
        <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">Market policies</h2>
        <table className="w-full text-left text-[12.5px]">
          <thead className="text-ink-muted">
            <tr>
              {["Market", "Status", "Partner", "Min sales 90d", "Min orders", "Offer range", "Fee", "Sweep", "Terms"].map(
                (heading) => (
                  <th key={heading} className="px-4.5 py-2 font-semibold">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {(policies.data ?? []).map((policy) => {
              // Policy amounts are in the market's currency; derive it the way the rest of the app does.
              const currency = policy.country === "NG" ? "NGN" : policy.country === "CI" ? "XOF" : "GHS";
              return (
                <tr key={policy.country} className="border-t border-[#F7F2EA]">
                  <td className="px-4.5 py-2 font-bold">{policy.country}</td>
                  <td className="px-4.5 py-2">
                    <Badge tone={policy.enabled ? "success" : "neutral"}>{policy.enabled ? "On" : "Off"}</Badge>
                  </td>
                  <td className="px-4.5 py-2">{policy.partner}</td>
                  <td className="px-4.5 py-2">{formatMoney(policy.min_gmv_90d_minor, currency)}</td>
                  <td className="px-4.5 py-2">{policy.min_orders_90d}</td>
                  <td className="px-4.5 py-2">
                    {formatMoney(policy.min_offer_minor, currency)} to {formatMoney(policy.max_offer_minor, currency)}
                  </td>
                  <td className="px-4.5 py-2">{formatBps(policy.fee_bps)}</td>
                  <td className="px-4.5 py-2">{formatBps(policy.sweep_bps)}</td>
                  <td className="px-4.5 py-2 font-mono">{policy.terms_version}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <h2 className="mb-2 text-[14px] font-bold">Recent advances (newest {ADVANCE_LIMIT})</h2>
      {!advances.data?.length ? (
        <EmptyState title="No advances yet" body="Accepted offers appear here." />
      ) : (
        <div className="grid gap-3">
          {advances.data.map((advance) => (
            <Panel key={advance.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px] font-bold text-ink">{advance.id}</span>
                    <Badge tone={STATE_TONE[advance.state] ?? "neutral"}>{advance.state}</Badge>
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-ink-muted">
                    Seller <span className="font-mono">{advance.seller_account_id}</span> · {advance.partner}
                    {advance.partner_reference ? ` · ref ${advance.partner_reference}` : ""} · accepted{" "}
                    {new Date(advance.accepted_at).toLocaleDateString()}
                  </p>
                  {advance.state_reason ? (
                    <p className="mt-0.5 text-[11.5px] text-ink-soft">Reason: {advance.state_reason}</p>
                  ) : null}
                </div>
                <div className="text-right text-[12px] text-ink-soft">
                  <p className="font-serif text-[18px] font-medium text-ink">
                    {formatMoney(advance.principal_minor, advance.currency)}
                  </p>
                  <p>
                    Swept {formatMoney(advance.swept_minor, advance.currency)} of{" "}
                    {formatMoney(advance.total_repayable_minor, advance.currency)}
                  </p>
                  <p>
                    Remitted {formatMoney(advance.remitted_minor, advance.currency)} · fee revenue{" "}
                    {formatMoney(advance.fee_revenue_minor, advance.currency)}
                  </p>
                </div>
              </div>

              {advance.state === "accepted" ? (
                <form action={cancelAdvanceAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line-soft pt-3">
                  <input type="hidden" name="advanceId" value={advance.id} />
                  <input name="reason" required aria-label="Reason" placeholder="Why the partner will not fund it" className={`${INPUT} min-w-[260px]`} />
                  <button className={BUTTON}>Cancel unfunded advance</button>
                </form>
              ) : null}
              {advance.state === "disbursed" || advance.state === "repaying" ? (
                <form action={closeAdvanceAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line-soft pt-3">
                  <input type="hidden" name="advanceId" value={advance.id} />
                  <select name="state" required aria-label="Close as" className={INPUT} defaultValue="defaulted">
                    <option value="defaulted">Defaulted</option>
                    <option value="written_off">Written off</option>
                  </select>
                  <input name="reason" required aria-label="Reason" placeholder="Partner's notice or reference" className={`${INPUT} min-w-[260px]`} />
                  <button className={BUTTON}>Close advance</button>
                </form>
              ) : null}
            </Panel>
          ))}
        </div>
      )}
    </main>
  );
}
