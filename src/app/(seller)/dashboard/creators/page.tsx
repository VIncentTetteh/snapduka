import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan, planAllows, planLimit } from "@/lib/billing/resolve";
import { calculateCreatorBalance, formatRate } from "@/lib/creators/commission";
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
    supabase
      .from("creator_commissions")
      .select("creator_id,status,amount_minor,currency")
      .eq("seller_account_id", actor.sellerAccountId),
  ]);

  const ledgerByCreator = new Map<string, { status: string; amountMinor: number; currency: string }[]>();
  for (const row of commissions ?? []) {
    const list = ledgerByCreator.get(row.creator_id) ?? [];
    list.push({ status: row.status, amountMinor: row.amount_minor, currency: row.currency });
    ledgerByCreator.set(row.creator_id, list);
  }

  const limit = planLimit(plan, "creatorPartnerships");
  const usedSeats =
    (partnerships ?? []).filter((p) => ["invited", "active", "paused"].includes(p.status)).length +
    (invitations ?? []).length;

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        title="Creators"
        sub="Pay influencers a commission on the sales they actually drive."
      />

      {params.error ? (
        <div role="alert" className="mb-4 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3 text-[13px] text-[#7A1B10]">
          {params.error}
        </div>
      ) : null}
      {params.message ? (
        <div role="status" className="mb-4 rounded-[10px] border border-line bg-white px-3.5 py-3 text-[13px] text-ink-soft">
          {params.message}
        </div>
      ) : null}

      {!allowed ? (
        <Panel className="mb-5">
          <p className="text-[14px] font-bold text-ink">Available on Growth and Scale</p>
          <p className="mt-1 text-[13px] leading-[1.6] text-ink-soft">
            Invite creators, give each a tracked link, and pay commission only on sales
            they bring in. SnapDuka tracks what is owed — you pay the creator directly.
          </p>
          <Link
            href="/dashboard/settings/billing"
            className="mt-3 inline-block text-[13px] font-bold text-accent no-underline hover:text-accent-deep"
          >
            See plans →
          </Link>
        </Panel>
      ) : (
        <Panel className="mb-5">
          <h2 className="text-[14px] font-bold text-ink">Invite a creator</h2>
          <p className="mt-1 mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
            They get their own link and a dashboard showing what they have earned.
            Commission is calculated on the product total after discounts, excluding delivery.
          </p>
          <form action={inviteCreator} className="grid gap-3 sm:grid-cols-[1fr_120px_120px_auto] sm:items-end">
            <Field label="Email or phone" htmlFor="creator-contact">
              <input
                id="creator-contact"
                name="contact"
                className={inputClasses()}
                placeholder="creator@example.com"
                required
              />
            </Field>
            <Field label="Commission" htmlFor="creator-rate">
              <input
                id="creator-rate"
                name="ratePercent"
                className={inputClasses()}
                defaultValue="10"
                inputMode="decimal"
                max="50"
                min="0.01"
                step="0.01"
                type="number"
                required
              />
            </Field>
            <Field label="Hold (days)" htmlFor="creator-hold" help="Before earnings can be paid">
              <input
                id="creator-hold"
                name="holdDays"
                className={inputClasses()}
                defaultValue="14"
                max="90"
                min="0"
                type="number"
                required
              />
            </Field>
            <SubmitButton
              className="h-11 cursor-pointer rounded-[10px] border-none bg-accent px-4 text-[13.5px] font-bold text-white hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
              pendingLabel="Sending…"
            >
              Send invite
            </SubmitButton>
          </form>
          <p className="mt-2.5 text-[11.5px] text-ink-faint">
            {usedSeats} of {limit} creator {limit === 1 ? "seat" : "seats"} used on {plan.planName}.
          </p>
        </Panel>
      )}

      {(invitations ?? []).length > 0 ? (
        <Panel className="mb-5">
          <h2 className="mb-2 text-[14px] font-bold text-ink">Pending invitations</h2>
          <ul className="grid gap-2">
            {(invitations ?? []).map((invite) => (
              <li key={invite.id} className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0">
                <div>
                  <p className="text-[13.5px] font-semibold text-ink">{invite.contact}</p>
                  <p className="text-[12px] text-ink-muted">
                    {formatRate(invite.rate_bps)} · expires {new Date(invite.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <form action={revokeCreatorInvitation}>
                  <input name="invitationId" type="hidden" value={invite.id} />
                  <SubmitButton
                    className="cursor-pointer rounded-[8px] border border-line-strong bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-soft hover:border-danger hover:text-danger"
                    pendingLabel="Revoking…"
                  >
                    Revoke
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {(partnerships ?? []).length === 0 ? (
        <EmptyState
          title="No creators yet"
          body="Invite someone who already posts about products like yours. They only earn when a sale comes from their link."
        />
      ) : (
        <Panel>
          <h2 className="mb-3 text-[14px] font-bold text-ink">Your creators</h2>
          <div className="grid gap-2.5">
            {(partnerships ?? []).map((partnership) => {
              const creator = partnership.creators as unknown as {
                display_name: string;
                handle: string;
              } | null;
              const ledger = ledgerByCreator.get(partnership.creator_id) ?? [];
              const balance = calculateCreatorBalance({
                commissions: ledger.map((row) => ({
                  status: row.status as "pending" | "payable" | "paid" | "reversed" | "void",
                  amountMinor: row.amountMinor,
                })),
              });
              const currency = (partnership.currency ?? "GHS") as CurrencyCode;
              return (
                <Link
                  key={partnership.id}
                  href={`/dashboard/creators/${partnership.id}`}
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-line bg-white px-3.5 py-3 no-underline transition-colors hover:border-[#B9AC98]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-bold text-ink">
                      {creator?.display_name ?? "Creator"}
                    </p>
                    <p className="truncate text-[12px] text-ink-muted">
                      @{creator?.handle ?? "unknown"} · {formatRate(partnership.rate_bps)} · {partnership.hold_days}-day hold
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="text-[13.5px] font-bold text-ink">
                        {formatMoney(balance.owedNowMinor, currency)}
                      </p>
                      <p className="text-[11px] text-ink-muted">owed now</p>
                    </div>
                    <Badge tone={STATUS_TONE[partnership.status] ?? "neutral"}>{partnership.status}</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        </Panel>
      )}
    </main>
  );
}
