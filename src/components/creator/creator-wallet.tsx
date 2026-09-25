import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Panel } from "@/components/ui/surface";
import { formatMoney, type CurrencyCode } from "@snapduka/core";
import type { CreatorWallet } from "@/lib/creators/wallet";

const WITHDRAWAL_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  requested: { label: "Awaiting review", tone: "warn" },
  approved: { label: "Queued", tone: "neutral" },
  processing: { label: "Sending", tone: "neutral" },
  paid: { label: "Paid", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
  reversed: { label: "Reversed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  needs_operator: { label: "Needs review", tone: "warn" },
};

export type CreatorWithdrawal = {
  id: string;
  reference: string;
  amount_minor: number;
  fee_minor: number;
  currency: string;
  status: string;
  failure_reason: string | null;
  review_reason: string | null;
  created_at: string;
};

/**
 * The creator's SnapDuka wallet: money shops paid THROUGH SnapDuka, held for
 * the creator and withdrawable once its hold is over. One block per currency;
 * a creator partnered with shops in two countries holds both and they are
 * never added together.
 *
 * Purely presentational, so the balance states — on hold, withdrawable, on its
 * way, owed back — can be tested without a seeded ledger.
 */
export function CreatorWalletBalances({ wallets }: { wallets: CreatorWallet[] }) {
  const showHeadings = wallets.length > 1;
  return (
    <>
      {wallets.map((wallet) => (
        <div key={wallet.currency} className="mb-4">
          {showHeadings ? (
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-[0.07em] text-ink-muted">
              {wallet.currency} balance
            </h2>
          ) : null}
          <div className="grid gap-2.5 sm:grid-cols-3">
            {[
              { label: "Ready to withdraw", value: wallet.availableMinor, hint: "Paid to you by SnapDuka" },
              { label: "On hold", value: wallet.pendingMinor, hint: "Until the order and your hold clear" },
              { label: "On its way", value: wallet.reservedMinor, hint: "Withdrawn, being sent to you" },
            ].map((tile) => (
              <Panel key={tile.label} className="px-3.5 py-3">
                <p className="text-[12px] font-semibold text-ink-muted">{tile.label}</p>
                <p className="mt-0.5 text-[22px] font-bold text-ink">{formatMoney(tile.value, wallet.currency)}</p>
                <p className="text-[11.5px] text-ink-faint">{tile.hint}</p>
              </Panel>
            ))}
          </div>
          {wallet.inArrears ? (
            <p className="mt-1.5 text-[12px] leading-[1.6] text-danger" role="note">
              An order was refunded after its commission reached you, so{" "}
              {formatMoney(Math.abs(wallet.availableMinor), wallet.currency)} is owed back. Nothing is due from
              you directly — it comes off your next commission, and withdrawals resume once the balance is positive.
            </p>
          ) : null}
        </div>
      ))}
    </>
  );
}

export function CreatorWithdrawals({ withdrawals }: { withdrawals: CreatorWithdrawal[] }) {
  if (withdrawals.length === 0) return null;
  return (
    <Panel className="overflow-hidden">
      <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">Withdrawals</h2>
      {withdrawals.map((payout) => {
        const spec = WITHDRAWAL_STATUS[payout.status] ?? { label: payout.status, tone: "neutral" as BadgeTone };
        const note = payout.failure_reason ?? payout.review_reason;
        const currency = payout.currency as CurrencyCode;
        return (
          <div key={payout.id} className="border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[12.5px] font-semibold text-ink-soft">{payout.reference}</span>
              <span className="flex items-center gap-2">
                <span className="text-[13.5px] font-bold text-ink">{formatMoney(payout.amount_minor, currency)}</span>
                <Badge tone={spec.tone}>{spec.label}</Badge>
              </span>
            </div>
            <p className="mt-0.5 text-[11.5px] text-ink-muted">
              {new Date(payout.created_at).toLocaleDateString()}
              {payout.fee_minor ? ` · ${formatMoney(payout.fee_minor, currency)} fee` : ""}
              {note ? ` · ${note}` : ""}
            </p>
          </div>
        );
      })}
    </Panel>
  );
}
