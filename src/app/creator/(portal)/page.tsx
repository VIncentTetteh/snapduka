import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/surface";
import { PageHeader } from "@/components/ui/surface";
import { resolveCreatorContext } from "@/lib/auth/actor";
import {
  calculateCreatorBalancesByCurrency,
  formatRate,
  type CreatorBalance,
} from "@/lib/creators/commission";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

const TONE: Record<string, "success" | "warn" | "neutral" | "danger"> = {
  pending: "warn",
  payable: "success",
  paid: "neutral",
  reversed: "danger",
  void: "neutral",
};

export default async function CreatorEarningsPage() {
  const creator = await resolveCreatorContext();
  // Gated on the creator profile so a shop owner promoting another shop qualifies.
  if (!creator) return null;
  const supabase = await createClient();

  const [{ data: commissions }, { data: adjustments }, { data: payments }] = await Promise.all([
    supabase
      .from("creator_commissions")
      .select("id,status,amount_minor,basis_minor,rate_bps,currency,order_reference,order_placed_at,payable_at,shop_display_name,reversal_reason")
      .eq("creator_id", creator.creatorId)
      .order("order_placed_at", { ascending: false })
      .limit(50),
    supabase
      .from("creator_commission_adjustments")
      .select("delta_minor,currency")
      .eq("creator_id", creator.creatorId),
    supabase
      .from("creator_commission_payments")
      .select("id,reference,amount_minor,currency,method,marked_at,confirmed_at,disputed_at")
      .eq("creator_id", creator.creatorId)
      .order("marked_at", { ascending: false })
      .limit(10),
  ]);

  // Split by currency. A creator can partner with shops in different countries,
  // and summing that ledger into one figure added cedis to naira and labelled
  // the result with whichever row sorted first.
  const balances = calculateCreatorBalancesByCurrency({
    commissions: (commissions ?? []).map((row) => ({
      status: row.status as "pending" | "payable" | "paid" | "reversed" | "void",
      amountMinor: row.amount_minor,
      currency: row.currency as CurrencyCode,
    })),
    adjustments: (adjustments ?? []).map((row) => ({
      deltaMinor: row.delta_minor,
      currency: row.currency as CurrencyCode,
    })),
  });
  const earned = Object.entries(balances) as [CurrencyCode, CreatorBalance][];
  // One currency is the common case and must look exactly as it did before, so
  // the currency heading only appears once there is something to tell apart.
  const showCurrencyHeadings = earned.length > 1;

  return (
    <main className="sd-main">
      <PageHeader title="Your earnings" sub={`Signed in as @${creator.handle}`} />

      {/* Stated plainly and up front: this is the single most important thing a
          creator needs to understand about how they get paid. */}
      <Panel className="mb-5 px-3.5 py-3">
        <p className="text-[12.5px] leading-[1.6] text-ink-soft">
          <strong className="font-bold text-ink">Shops pay you directly.</strong> SnapDuka
          tracks every sale from your links and what you have earned, but does not hold or
          send the money. If something looks wrong, raise it with the shop first.
        </p>
      </Panel>

      {earned.length === 0 ? (
        <Panel className="mb-5 px-3.5 py-3">
          <p className="text-[13px] text-ink-soft">
            Nothing earned yet. Your first sale through one of your links will show up here.
          </p>
        </Panel>
      ) : null}

      {earned.map(([currency, balance]) => (
        <div key={currency} className="mb-5">
          {showCurrencyHeadings ? (
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-[0.07em] text-ink-muted">
              {currency} earnings
            </h2>
          ) : null}
          <div className="grid gap-2.5 sm:grid-cols-3">
            {[
              { label: "Ready to be paid", value: balance.owedNowMinor, hint: "Past the hold window" },
              { label: "On hold", value: balance.pendingMinor, hint: "Waiting out the refund window" },
              { label: "Paid to date", value: balance.paidMinor, hint: "Recorded by the shop" },
            ].map((tile) => (
              <Panel key={tile.label} className="px-3.5 py-3">
                <p className="text-[12px] font-semibold text-ink-muted">{tile.label}</p>
                <p className="mt-0.5 text-[22px] font-bold text-ink">{formatMoney(tile.value, currency)}</p>
                <p className="text-[11.5px] text-ink-faint">{tile.hint}</p>
              </Panel>
            ))}
          </div>
          {balance.carryOverMinor < 0 ? (
            <p className="mt-1.5 text-[11.5px] text-ink-muted">
              {formatMoney(Math.abs(balance.carryOverMinor), currency)} carried over from a
              reversal — it comes off your next payout.
            </p>
          ) : null}
        </div>
      ))}

      {(payments ?? []).length > 0 ? (
        <Panel className="mb-5 p-4.5">
          <h2 className="mb-2 text-[14px] font-bold text-ink">Payments</h2>
          <ul className="grid gap-2">
            {(payments ?? []).map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 border-b border-line pb-2 text-[13px] last:border-0">
                <span className="text-ink-soft">
                  {new Date(payment.marked_at).toLocaleDateString()} · {payment.method.replace("_", " ")}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-ink">
                    {formatMoney(payment.amount_minor, payment.currency as CurrencyCode)}
                  </span>
                  {payment.disputed_at ? (
                    <Badge tone="danger">disputed</Badge>
                  ) : payment.confirmed_at ? (
                    <Badge tone="success">confirmed</Badge>
                  ) : (
                    <Badge tone="warn">shop says paid</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel className="p-4.5">
        <h2 className="mb-2.5 text-[14px] font-bold text-ink">Sales from your links</h2>
        {(commissions ?? []).length === 0 ? (
          <EmptyState
            title="No sales yet"
            body="Share one of your links. Earnings appear here as soon as a buyer pays."
          />
        ) : (
          <ul className="grid gap-2">
            {(commissions ?? []).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 border-b border-line pb-2.5 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-ink">{row.shop_display_name}</p>
                  <p className="truncate text-[12px] text-ink-muted">
                    {row.order_reference} · {new Date(row.order_placed_at).toLocaleDateString()} ·{" "}
                    {formatRate(row.rate_bps)} of {formatMoney(row.basis_minor, row.currency as CurrencyCode)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <span className="text-[13.5px] font-bold text-ink">
                    {formatMoney(row.amount_minor, row.currency as CurrencyCode)}
                  </span>
                  <Badge tone={TONE[row.status] ?? "neutral"}>
                    {row.status === "pending"
                      ? `ready ${new Date(row.payable_at).toLocaleDateString()}`
                      : row.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
