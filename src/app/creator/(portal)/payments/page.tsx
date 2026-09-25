import { CreatorDestinationForm, CreatorWithdrawForm } from "@/components/creator/creator-payout-forms";
import {
  CreatorWalletBalances,
  CreatorWithdrawals,
  type CreatorWithdrawal,
} from "@/components/creator/creator-wallet";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveCreatorContext } from "@/lib/auth/actor";
import { formatMoney, getCountryConfig } from "@snapduka/core";
import { fetchPartnerShops } from "@/lib/creators/partner-shops";
import {
  OPEN_WITHDRAWAL_STATUSES,
  creatorWithdrawBlocker,
  parseCreatorWallets,
  type CreatorWalletRow,
} from "@/lib/creators/wallet";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@snapduka/core";

import { respondToPayment } from "./actions";

export const dynamic = "force-dynamic";

export default async function CreatorPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const creator = await resolveCreatorContext();
  // Gated on the creator profile so a shop owner promoting another shop qualifies.
  if (!creator) return null;
  const params = await searchParams;
  const supabase = await createClient();

  const currency = getCountryConfig(creator.country).currency;

  const [{ data: payments }, { data: walletRows }, { data: destinationRows }, { data: withdrawals }, { data: config }] =
    await Promise.all([
      supabase
        .from("creator_commission_payments")
        .select("id,reference,amount_minor,currency,method,marked_at,confirmed_at,disputed_at,dispute_note,seller_account_id")
        .eq("creator_id", creator.creatorId)
        .order("marked_at", { ascending: false })
        // Bounded: db.max_rows would cut an unbounded list at 1000 anyway, and
        // unlike the totals nothing here is summed.
        .limit(100),
      // Balances come from the ledger, aggregated in SQL, for the signed-in
      // creator only — the RPC takes no id to forge.
      supabase.rpc("creator_wallet_balances"),
      // Through an RPC so recipient_code stays unreadable, and so the cool-off
      // uses the same database clock request_creator_payout enforces it with.
      supabase.rpc("creator_payout_destination"),
      supabase
        .from("payout_requests")
        .select("id,reference,amount_minor,fee_minor,currency,status,failure_reason,review_reason,created_at")
        .eq("creator_id", creator.creatorId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("country_configs")
        .select("payouts_enabled,minimum_payout_minor,payout_fee_minor")
        .eq("country", creator.country)
        .maybeSingle(),
    ]);

  const shops = await fetchPartnerShops((payments ?? []).map((p) => p.seller_account_id));

  // The wallet only exists for creators some shop has paid through SnapDuka
  // (the creator_ledger_payouts rollout). Everyone else sees exactly the page
  // they saw before: payments the shop recorded, to confirm.
  const wallets = parseCreatorWallets(walletRows as CreatorWalletRow[] | null);
  const destination = (destinationRows ?? []).find((row) => row.currency === currency) ?? null;
  const payoutRows = (withdrawals ?? []) as CreatorWithdrawal[];
  const hasWallet = wallets.length > 0 || destination !== null || payoutRows.length > 0;
  const available = wallets.find((wallet) => wallet.currency === currency)?.availableMinor ?? 0;
  const feeMinor = config?.payout_fee_minor ?? 100;
  const minimumMinor = config?.minimum_payout_minor ?? 5000;
  const destinationLabel = destination ? `${destination.bank_name} •••${destination.account_last4}` : null;
  const blocker = creatorWithdrawBlocker({
    payoutsEnabled: Boolean(config?.payouts_enabled),
    hasDestination: destination !== null,
    coolingOff: Boolean(destination?.cooling_off),
    hasOpenWithdrawal: payoutRows.some((row) =>
      (OPEN_WITHDRAWAL_STATUSES as readonly string[]).includes(row.status),
    ),
    availableMinor: available,
    minimumMinor,
    feeMinor,
  });

  return (
    <main className="sd-main">
      <PageHeader
        title="Payments"
        sub="Confirm what you actually received, so both sides have the same record."
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

      {hasWallet ? (
        <section className="mb-6" aria-labelledby="wallet-heading">
          <h2 id="wallet-heading" className="mb-1 text-[15px] font-bold text-ink">
            Your SnapDuka balance
          </h2>
          <p className="mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
            Some shops pay your commission through SnapDuka: it is set aside from the sale, held
            until the order and your hold period clear, then it is yours to withdraw.
          </p>
          <CreatorWalletBalances wallets={wallets} />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="grid gap-4">
              <CreatorWithdrawForm
                availableMinor={available}
                currency={currency}
                minimumMinor={minimumMinor}
                feeMinor={feeMinor}
                blocker={blocker}
                destinationLabel={destinationLabel}
              />
              <CreatorDestinationForm
                currentLabel={destinationLabel}
                currentAccountName={destination?.resolved_account_name ?? null}
                coolingOff={Boolean(destination?.cooling_off)}
              />
            </div>
            <CreatorWithdrawals withdrawals={payoutRows} />
          </div>
        </section>
      ) : null}

      {hasWallet && (payments ?? []).length > 0 ? (
        <h2 className="mb-2 text-[15px] font-bold text-ink">Paid to you by shops directly</h2>
      ) : null}

      {(payments ?? []).length === 0 ? (
        hasWallet ? null : (
          <EmptyState
            title="No payments yet"
            body="When a shop records paying you, it appears here for you to confirm."
          />
        )
      ) : (
        <div className="grid gap-2.5">
          {(payments ?? []).map((payment) => {
            const resolved = payment.confirmed_at ?? payment.disputed_at;
            return (
              <Panel key={payment.id} className="px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-bold text-ink">
                      {formatMoney(payment.amount_minor, payment.currency as CurrencyCode)}
                    </p>
                    {/* Who paid it. A creator confirming money received needs to
                        know which shop it came from before they can agree. */}
                    <p className="text-[12.5px] font-semibold text-ink-soft">
                      {shops.get(payment.seller_account_id)?.displayName ?? "A SnapDuka shop"}
                    </p>
                    <p className="text-[12px] text-ink-muted">
                      {payment.reference} · {payment.method.replace("_", " ")} ·{" "}
                      {new Date(payment.marked_at).toLocaleDateString()}
                    </p>
                  </div>
                  {payment.disputed_at ? (
                    <Badge tone="danger">you reported a problem</Badge>
                  ) : payment.confirmed_at ? (
                    <Badge tone="success">you confirmed</Badge>
                  ) : (
                    <Badge tone="warn">shop says paid</Badge>
                  )}
                </div>

                {payment.dispute_note ? (
                  <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-soft">
                    You said: {payment.dispute_note}
                  </p>
                ) : null}

                {!resolved ? (
                  <div className="mt-3 grid gap-2 border-t border-line pt-3">
                    <form action={respondToPayment}>
                      <input name="paymentId" type="hidden" value={payment.id} />
                      <input name="action" type="hidden" value="confirm" />
                      <SubmitButton
                        className="h-10 w-full cursor-pointer rounded-[10px] border-none bg-accent text-[13.5px] font-bold text-white hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
                        pendingLabel="Confirming…"
                      >
                        I received this
                      </SubmitButton>
                    </form>
                    <form action={respondToPayment} className="grid gap-2">
                      <input name="paymentId" type="hidden" value={payment.id} />
                      <input name="action" type="hidden" value="dispute" />
                      <input
                        className={inputClasses()}
                        name="note"
                        placeholder="What went wrong? The shop will see this."
                        required
                      />
                      <SubmitButton
                        className="h-10 cursor-pointer rounded-[10px] border border-line-strong bg-white text-[13px] font-semibold text-ink-soft hover:border-danger hover:text-danger disabled:cursor-wait"
                        pendingLabel="Sending…"
                      >
                        Report a problem
                      </SubmitButton>
                    </form>
                  </div>
                ) : null}
              </Panel>
            );
          })}
        </div>
      )}
    </main>
  );
}
