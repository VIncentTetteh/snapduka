import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan, planAllows, planLimit } from "@/lib/billing/resolve";
import { formatRate } from "@/lib/creators/commission";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

import { inviteCreator, revokeCreatorInvitation } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "success" | "warn" | "neutral"> = {
  active: "success",
  invited: "warn",
  paused: "warn",
  ended: "neutral",
  declined: "neutral",
};

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const params = await searchParams;
  const supabase = await createClient();
  const plan = await getSellerPlan(actor.sellerAccountId);
  const allowed = planAllows(plan, "creatorProgram");

  const [{ data: partnerships }, { data: invitations }, { data: commissions }] = await Promise.all([
    supabase
      .from("creator_partnerships")
      .select("id,status,rate_bps,hold_days,currency,creator_id,creators(display_name,handle)")
      .eq("seller_account_id", actor.sellerAccountId)
      .order("invited_at", { ascending: false }),
    supabase
      .from("creator_invitations")
      .select("id,contact,rate_bps,expires_at")
      .eq("seller_account_id", actor.sellerAccountId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()),
    // Totalled in SQL. This pulled the seller's entire commission ledger to
    // build a per-creator balance and an "owed now" figure, so past
    // db.max_rows both understated what the seller owes — and understating a
    // debt to a creator is the direction that causes an argument.
    supabase.rpc("seller_creator_commission_totals"),
  ]);

  type CommissionTotals = {
    creator_id: string;
    currency: string;
    pending_minor: number;
    payable_minor: number;
    paid_minor: number;
    reversed_minor: number;
  };

  const totalsByCreator = new Map<string, CommissionTotals[]>();
  for (const row of (commissions ?? []) as CommissionTotals[]) {
    const list = totalsByCreator.get(row.creator_id) ?? [];
    list.push(row);
    totalsByCreator.set(row.creator_id, list);
  }

  const limit = planLimit(plan, "creatorPartnerships");
  const activeCreators = (partnerships ?? []).filter((partnership) => partnership.status === "active").length;
  const pendingInvites = (invitations ?? []).length;
  const usedSeats =
    (partnerships ?? []).filter((partnership) => ["invited", "active", "paused"].includes(partnership.status)).length +
    pendingInvites;
  const owedNow = ((commissions ?? []) as CommissionTotals[]).reduce(
    (total, row) => total + Number(row.payable_minor),
    0,
  );
  const programmeCurrency = ((partnerships ?? [])[0]?.currency ??
    ((commissions ?? []) as CommissionTotals[])[0]?.currency ??
    "GHS") as CurrencyCode;

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        eyebrow="Growth"
        title="Creators"
        sub="Partner with people your customers trust, and pay only for sales they generate."
        actions={
          allowed ? (
            <a className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-accent px-5 text-[14px] font-semibold text-white no-underline shadow-btn transition-colors hover:bg-accent-deep" href="#invite-creator">
              Invite creator
            </a>
          ) : (
            <ButtonLink href="/dashboard/settings/billing">View plans</ButtonLink>
          )
        }
      />

      {params.error ? (
        <div role="alert" className="mb-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-[13px] font-semibold text-danger">
          {params.error}
        </div>
      ) : null}
      {params.message ? (
        <div role="status" className="mb-4 rounded-xl border border-[#BFE3D2] bg-[#E7F4EE] px-4 py-3 text-[13px] font-semibold text-success">
          {params.message}
        </div>
      ) : null}

      {!allowed ? (
        <Panel className="overflow-hidden">
          <div className="grid gap-7 bg-[linear-gradient(135deg,#FFF8F1_0%,#FFFFFF_62%)] p-5 sm:p-7 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
            <div>
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-tint text-accent" aria-hidden="true">
                <svg fill="none" height="22" viewBox="0 0 24 24" width="22"><path d="M16 18.5c0-2-1.8-3.5-4-3.5s-4 1.5-4 3.5M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm5.5.5c1.5.5 2.5 1.6 2.5 3M17 6.2a2.5 2.5 0 0 1 0 4.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6"/></svg>
              </span>
              <p className="mt-5 text-[12px] font-bold uppercase tracking-[0.08em] text-accent">Included with Growth and Scale</p>
              <h2 className="mt-2 max-w-[18ch] font-serif text-[clamp(24px,3vw,32px)] font-medium leading-[1.15] text-ink">
                Turn word of mouth into measurable sales.
              </h2>
              <p className="mt-3 max-w-[58ch] text-[14px] leading-[1.65] text-ink-soft">
                Give each creator a tracked link, set a commission, and see exactly what they have earned. You stay in control of approvals and payouts.
              </p>
              <ButtonLink className="mt-5" href="/dashboard/settings/billing">Compare plans</ButtonLink>
            </div>
            <div className="grid gap-2.5">
              {[
                ["01", "Invite", "Email or phone is enough to begin."],
                ["02", "Track", "Attribute clicks, orders and commission."],
                ["03", "Pay", "Settle verified earnings directly."],
              ].map(([number, title, body]) => (
                <div key={number} className="flex gap-3 rounded-xl border border-line bg-white/85 p-3.5 shadow-[0_6px_20px_rgba(57,44,31,0.04)]">
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-ink text-[11px] font-bold text-white">{number}</span>
                  <span>
                    <span className="block text-[13.5px] font-bold text-ink">{title}</span>
                    <span className="mt-0.5 block text-[12px] leading-[1.45] text-ink-muted">{body}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Active creators", value: String(activeCreators), sub: `${usedSeats} of ${limit} seats used` },
              { label: "Pending invites", value: String(pendingInvites), sub: pendingInvites ? "Waiting for a response" : "No outstanding invites" },
              { label: "Ready to pay", value: formatMoney(owedNow, programmeCurrency), sub: "Approved commission" },
            ].map((metric) => (
              <Panel key={metric.label} className="p-4.5">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">{metric.label}</p>
                <p className="mt-2 font-serif text-[25px] font-medium leading-none text-ink">{metric.value}</p>
                <p className="mt-2 text-[11.5px] text-ink-muted">{metric.sub}</p>
              </Panel>
            ))}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
            <div className="grid gap-4">
              {(partnerships ?? []).length === 0 ? (
                <EmptyState
                  icon={<svg fill="none" height="22" viewBox="0 0 24 24" width="22"><path d="M16 18.5c0-2-1.8-3.5-4-3.5s-4 1.5-4 3.5M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.6"/></svg>}
                  title="Build your creator team"
                  body="Invite someone who already talks about products like yours. They only earn when their link produces a sale."
                  action={<a className="text-[13px] font-bold text-accent no-underline hover:text-accent-deep" href="#invite-creator">Send your first invite →</a>}
                />
              ) : (
                <Panel className="overflow-hidden">
                  <div className="border-b border-line-soft bg-raised/60 px-4.5 py-3.5">
                    <h2 className="text-[14px] font-bold text-ink">Your creators</h2>
                    <p className="mt-0.5 text-[11.5px] text-ink-muted">Select a creator to review links, sales and payouts.</p>
                  </div>
                  {(partnerships ?? []).map((partnership) => {
                    const creator = partnership.creators as unknown as { display_name: string; handle: string } | null;
                    const currency = (partnership.currency ?? "GHS") as CurrencyCode;
                    // One row per currency, and only the partnership's own is
                    // shown — adding another currency's minor units into this
                    // figure is the mistake calculateCreatorBalancesByCurrency
                    // exists to prevent.
                    const totals = (totalsByCreator.get(partnership.creator_id) ?? []).find(
                      (row) => row.currency === currency,
                    );
                    // No adjustments in this roll-up, so what is owed is simply
                    // what is payable — matching calculateCreatorBalance, which
                    // floors at zero.
                    const owedMinor = Math.max(0, Number(totals?.payable_minor ?? 0));
                    return (
                      <Link
                        key={partnership.id}
                        href={`/dashboard/creators/${partnership.id}`}
                        className="flex items-center justify-between gap-3 border-b border-line-soft px-4.5 py-3.5 no-underline transition-colors last:border-0 hover:bg-raised"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span aria-hidden="true" className="grid h-10 w-10 flex-none place-items-center rounded-full bg-accent-tint font-serif text-[16px] font-bold text-accent">
                            {(creator?.display_name ?? "C").slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-bold text-ink">{creator?.display_name ?? "Creator"}</span>
                            <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">@{creator?.handle ?? "unknown"} · {formatRate(partnership.rate_bps)}</span>
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="text-right">
                            <span className="block text-[13px] font-bold text-ink">{formatMoney(owedMinor, currency)}</span>
                            <span className="block text-[10.5px] text-ink-muted">ready to pay</span>
                          </span>
                          <Badge tone={STATUS_TONE[partnership.status] ?? "neutral"}>{partnership.status}</Badge>
                        </div>
                      </Link>
                    );
                  })}
                </Panel>
              )}

              {pendingInvites > 0 ? (
                <Panel className="overflow-hidden">
                  <div className="border-b border-line-soft px-4.5 py-3.5"><h2 className="text-[14px] font-bold text-ink">Pending invitations</h2></div>
                  {(invitations ?? []).map((invite) => (
                    <div key={invite.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-4.5 py-3 last:border-0">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-ink">{invite.contact}</p>
                        <p className="mt-0.5 text-[11.5px] text-ink-muted">{formatRate(invite.rate_bps)} · expires {new Date(invite.expires_at).toLocaleDateString()}</p>
                      </div>
                      <form action={revokeCreatorInvitation}>
                        <input name="invitationId" type="hidden" value={invite.id} />
                        <SubmitButton className="cursor-pointer rounded-lg border border-line-strong bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-soft hover:border-danger hover:text-danger" pendingLabel="Revoking…">Revoke</SubmitButton>
                      </form>
                    </div>
                  ))}
                </Panel>
              ) : null}
            </div>

            <Panel className="p-4.5 lg:sticky lg:top-5" >
              <div id="invite-creator" className="scroll-mt-5">
                <p className="text-[11.5px] font-bold uppercase tracking-[0.07em] text-accent">New partnership</p>
                <h2 className="mt-1.5 font-serif text-[20px] font-medium text-ink">Invite a creator</h2>
                <p className="mt-1.5 text-[12.5px] leading-[1.55] text-ink-soft">Set the terms now. Commission excludes delivery and applies after discounts.</p>
              </div>
              <form action={inviteCreator} className="mt-4 grid gap-3.5">
                <Field label="Email or phone" htmlFor="creator-contact">
                  <input id="creator-contact" name="contact" className={inputClasses()} placeholder="creator@example.com" required />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Commission %" htmlFor="creator-rate">
                    <input id="creator-rate" name="ratePercent" className={inputClasses()} defaultValue="10" inputMode="decimal" max="50" min="0.01" step="0.01" type="number" required />
                  </Field>
                  <Field label="Hold days" htmlFor="creator-hold" help="Before payout">
                    <input id="creator-hold" name="holdDays" className={inputClasses()} defaultValue="14" max="90" min="0" type="number" required />
                  </Field>
                </div>
                <SubmitButton className="min-h-11 cursor-pointer rounded-[10px] border-none bg-accent px-4 text-[13.5px] font-bold text-white hover:bg-accent-deep disabled:cursor-wait disabled:opacity-60" pendingLabel="Sending…">Send invitation</SubmitButton>
              </form>
              <div className="mt-4 border-t border-line-soft pt-3">
                <div className="mb-1.5 flex justify-between text-[11.5px] font-semibold text-ink-muted"><span>Creator seats</span><span>{usedSeats} / {limit}</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-line-soft"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, limit > 0 ? (usedSeats / limit) * 100 : 0)}%` }} /></div>
                <p className="mt-2 text-[11px] text-ink-faint">Included with your {plan.planName} plan.</p>
              </div>
            </Panel>
          </div>
        </>
      )}
    </main>
  );
}
