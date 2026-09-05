import Link from "next/link";
import { shortLinkUrl } from "@snapduka/core";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel } from "@/components/ui/surface";
import { appOrigin } from "@/lib/app-url";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatRate } from "@/lib/creators/commission";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

import { createCreatorLink, markCommissionsPaid, updatePartnership } from "../actions";

export const dynamic = "force-dynamic";

const COMMISSION_TONE: Record<string, "success" | "warn" | "neutral" | "danger"> = {
  pending: "warn",
  payable: "success",
  paid: "neutral",
  reversed: "danger",
  void: "neutral",
};

export default async function CreatorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ partnershipId: string }>;
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const { partnershipId } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const origin = await appOrigin();

  const { data: partnership } = await supabase
    .from("creator_partnerships")
    .select("id,status,rate_bps,hold_days,currency,creator_id,creators(display_name,handle,contact_phone,contact_email,payout_details)")
    .eq("id", partnershipId)
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();

  if (!partnership) notFound();

  const creator = partnership.creators as unknown as {
    display_name: string;
    handle: string;
    contact_phone: string;
    contact_email: string | null;
    payout_details: Record<string, unknown>;
  } | null;

  const [{ data: commissions }, { data: balanceRows }, { data: links }, { data: payments }] =
    await Promise.all([
      // The 200 most recent, for the two lists on this page.
      supabase
        .from("creator_commissions")
        .select("id,status,amount_minor,basis_minor,rate_bps,currency,order_reference,order_placed_at,payable_at,reversal_reason")
        .eq("seller_account_id", actor.sellerAccountId)
        .eq("creator_id", partnership.creator_id)
        .order("order_placed_at", { ascending: false })
        .limit(200),
      // The balance, over the whole ledger. This is the figure the seller is
      // about to pay against, and it was computed from an unbounded select that
      // PostgREST caps at db.max_rows — so a productive creator would have been
      // paid less than they had earned. creator_commission_balances is
      // SECURITY INVOKER, so a seller calling it sees only commissions on their
      // own shop: exactly "what I owe this creator".
      supabase.rpc("creator_commission_balances", { p_creator_id: partnership.creator_id }),
      supabase
        .from("campaign_links")
        .select("id,token,name,active")
        .eq("creator_partnership_id", partnershipId),
      supabase
        .from("creator_commission_payments")
        .select("id,reference,amount_minor,currency,method,marked_at,confirmed_at,disputed_at")
        .eq("seller_account_id", actor.sellerAccountId)
        .eq("creator_id", partnership.creator_id)
        .order("marked_at", { ascending: false }),
    ]);

  const currency = (partnership.currency ?? "GHS") as CurrencyCode;
  type BalanceRow = {
    currency: string;
    pending_minor: number;
    payable_minor: number;
    paid_minor: number;
    reversed_minor: number;
    owed_now_minor: number;
    carry_over_minor: number;
  };
  // The partnership's own currency only. A creator partnered with shops in two
  // countries has a row per currency, and adding them would mix cedis into
  // naira.
  const row = ((balanceRows ?? []) as BalanceRow[]).find((entry) => entry.currency === currency);
  const balance = {
    pendingMinor: Number(row?.pending_minor ?? 0),
    payableMinor: Number(row?.payable_minor ?? 0),
    paidMinor: Number(row?.paid_minor ?? 0),
    reversedMinor: Number(row?.reversed_minor ?? 0),
    owedNowMinor: Number(row?.owed_now_minor ?? 0),
    carryOverMinor: Number(row?.carry_over_minor ?? 0),
  };
  const payable = (commissions ?? []).filter((commission) => commission.status === "payable");

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <Link href="/dashboard/creators" className="mb-3 inline-block text-[12.5px] font-semibold text-ink-soft no-underline hover:text-ink">
        ← All creators
      </Link>
      <PageHeader
        title={creator?.display_name ?? "Creator"}
        sub={`@${creator?.handle ?? "unknown"} · ${formatRate(partnership.rate_bps)} on products after discount, excluding delivery`}
      />

      {query.error ? (
        <div role="alert" className="mb-4 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3 text-[13px] text-[#7A1B10]">
          {query.error}
        </div>
      ) : null}
      {query.message ? (
        <div role="status" className="mb-4 rounded-[10px] border border-line bg-white px-3.5 py-3 text-[13px] text-ink-soft">
          {query.message}
        </div>
      ) : null}

      <div className="mb-5 grid gap-2.5 sm:grid-cols-3">
        {[
          { label: "Owed now", value: balance.owedNowMinor, hint: "Held long enough to pay" },
          { label: "On hold", value: balance.pendingMinor, hint: `${partnership.hold_days}-day refund window` },
          { label: "Paid to date", value: balance.paidMinor, hint: "Recorded by you" },
        ].map((tile) => (
          <Panel key={tile.label} className="px-3.5 py-3">
            <p className="text-[12px] font-semibold text-ink-muted">{tile.label}</p>
            <p className="mt-0.5 text-[22px] font-bold text-ink">{formatMoney(tile.value, currency)}</p>
            <p className="text-[11.5px] text-ink-faint">{tile.hint}</p>
          </Panel>
        ))}
      </div>

      {balance.carryOverMinor < 0 ? (
        <Panel className="mb-5 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-danger">
            {formatMoney(Math.abs(balance.carryOverMinor), currency)} owed back
          </p>
          <p className="mt-0.5 text-[12.5px] leading-[1.6] text-ink-soft">
            An order was refunded after you had already paid the commission on it. This
            amount is netted off the next payment rather than requested back.
          </p>
        </Panel>
      ) : null}

      {/* Links */}
      <Panel className="mb-5 p-4.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-bold text-ink">Their links</h2>
          <form action={createCreatorLink}>
            <input name="partnershipId" type="hidden" value={partnershipId} />
            <SubmitButton
              className="cursor-pointer rounded-[8px] border border-line-strong bg-white px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-[#B9AC98]"
              pendingLabel="Creating…"
            >
              New link
            </SubmitButton>
          </form>
        </div>
        {(links ?? []).length === 0 ? (
          <p className="mt-2 text-[12.5px] text-ink-muted">
            No link yet. Create one and share it with them — only sales through their own
            link earn commission.
          </p>
        ) : (
          <ul className="mt-2.5 grid gap-2">
            {(links ?? []).map((link) => (
              <li key={link.id} className="flex items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
                <code className="truncate font-mono text-[12.5px] text-ink-soft">
                  {origin}/l/{link.token}
                </code>
                <CopyButton value={shortLinkUrl(origin, link.token)} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Mark paid */}
      {payable.length > 0 ? (
        <Panel className="mb-5 p-4.5">
          <h2 className="text-[14px] font-bold text-ink">Record a payment</h2>
          <p className="mt-1 mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
            Send {creator?.display_name ?? "the creator"} the money first —
            {creator?.payout_details && Object.keys(creator.payout_details).length > 0
              ? ` ${JSON.stringify(creator.payout_details)}`
              : ` on ${creator?.contact_phone ?? "their contact number"}`}
            . SnapDuka does not move money; this only records that you paid.
          </p>
          <form action={markCommissionsPaid} className="grid gap-3">
            <input name="partnershipId" type="hidden" value={partnershipId} />
            <input name="creatorId" type="hidden" value={partnership.creator_id} />
            <ul className="grid gap-1.5">
              {payable.map((row) => (
                <li key={row.id} className="flex items-center gap-2.5 text-[13px]">
                  <input
                    className="h-4 w-4 accent-[#8C2F0D]"
                    defaultChecked
                    id={`c-${row.id}`}
                    name="commissionIds"
                    type="checkbox"
                    value={row.id}
                  />
                  <label className="flex-1 cursor-pointer text-ink-soft" htmlFor={`c-${row.id}`}>
                    {row.order_reference} · {new Date(row.order_placed_at).toLocaleDateString()}
                  </label>
                  <span className="font-semibold text-ink">{formatMoney(row.amount_minor, currency)}</span>
                </li>
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
              <Field label="Method" htmlFor="pay-method">
                <select className={inputClasses()} id="pay-method" name="method" defaultValue="mobile_money">
                  <option value="mobile_money">Mobile money</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Reference" htmlFor="pay-ref" optional>
                <input className={inputClasses()} id="pay-ref" name="externalReference" placeholder="MoMo transaction ID" />
              </Field>
              <SubmitButton
                className="h-11 cursor-pointer rounded-[10px] border-none bg-accent px-4 text-[13.5px] font-bold text-white hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
                pendingLabel="Recording…"
              >
                Mark as paid
              </SubmitButton>
            </div>
          </form>
        </Panel>
      ) : null}

      {/* Ledger */}
      <Panel className="mb-5 p-4.5">
        <h2 className="mb-2.5 text-[14px] font-bold text-ink">Commission history</h2>
        {(commissions ?? []).length === 0 ? (
          <EmptyState title="No sales yet" body="Commission appears here once an order through their link is paid." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink-faint">
                  <th className="pb-2 font-bold">Order</th>
                  <th className="pb-2 font-bold">Basis</th>
                  <th className="pb-2 font-bold">Rate</th>
                  <th className="pb-2 font-bold">Commission</th>
                  <th className="pb-2 font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {(commissions ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="py-2 text-ink-soft">{row.order_reference}</td>
                    <td className="py-2 text-ink-soft">{formatMoney(row.basis_minor, currency)}</td>
                    <td className="py-2 text-ink-soft">{formatRate(row.rate_bps)}</td>
                    <td className="py-2 font-semibold text-ink">{formatMoney(row.amount_minor, currency)}</td>
                    <td className="py-2">
                      <Badge tone={COMMISSION_TONE[row.status] ?? "neutral"}>
                        {row.status === "pending"
                          ? `holds to ${new Date(row.payable_at).toLocaleDateString()}`
                          : row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {(payments ?? []).length > 0 ? (
        <Panel className="mb-5 p-4.5">
          <h2 className="mb-2 text-[14px] font-bold text-ink">Payments you recorded</h2>
          <ul className="grid gap-2">
            {(payments ?? []).map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 border-b border-line pb-2 text-[13px] last:border-0">
                <span className="text-ink-soft">
                  {payment.reference} · {new Date(payment.marked_at).toLocaleDateString()}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{formatMoney(payment.amount_minor, currency)}</span>
                  {payment.disputed_at ? (
                    <Badge tone="danger">disputed</Badge>
                  ) : payment.confirmed_at ? (
                    <Badge tone="success">confirmed</Badge>
                  ) : (
                    <Badge tone="warn">awaiting confirmation</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* Terms */}
      <Panel className="p-4.5">
        <h2 className="mb-3 text-[14px] font-bold text-ink">Partnership</h2>
        <form action={updatePartnership} className="grid gap-3 sm:grid-cols-[140px_auto_auto] sm:items-end">
          <input name="partnershipId" type="hidden" value={partnershipId} />
          <input name="intent" type="hidden" value="rate" />
          <Field label="Commission %" htmlFor="rate" help="Applies to future orders only">
            <input
              className={inputClasses()}
              defaultValue={partnership.rate_bps / 100}
              id="rate"
              max="50"
              min="0.01"
              name="ratePercent"
              step="0.01"
              type="number"
            />
          </Field>
          <SubmitButton
            className="h-11 cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-ink hover:border-[#B9AC98]"
            pendingLabel="Saving…"
          >
            Update rate
          </SubmitButton>
        </form>
        <div className="mt-3 flex gap-2 border-t border-line pt-3">
          <form action={updatePartnership}>
            <input name="partnershipId" type="hidden" value={partnershipId} />
            <input name="intent" type="hidden" value={partnership.status === "paused" ? "resume" : "pause"} />
            <SubmitButton
              className="cursor-pointer rounded-[8px] border border-line-strong bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-soft hover:border-[#B9AC98] hover:text-ink"
              pendingLabel="Saving…"
            >
              {partnership.status === "paused" ? "Resume partnership" : "Pause partnership"}
            </SubmitButton>
          </form>
          <form action={updatePartnership}>
            <input name="partnershipId" type="hidden" value={partnershipId} />
            <input name="intent" type="hidden" value="end" />
            <SubmitButton
              className="cursor-pointer rounded-[8px] border border-line-strong bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-soft hover:border-danger hover:text-danger"
              pendingLabel="Ending…"
            >
              End partnership
            </SubmitButton>
          </form>
        </div>
        <p className="mt-2.5 text-[11.5px] leading-[1.5] text-ink-faint">
          Pausing stops new commission accruing. Earnings already accrued stay owed either way —
          a creator who has posted cannot be un-paid.
        </p>
      </Panel>
    </main>
  );
}
