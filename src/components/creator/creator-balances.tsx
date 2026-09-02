import { Panel } from "@/components/ui/surface";
import type { CurrencyCode } from "@/lib/countries/types";
import type { CreatorBalance } from "@/lib/creators/commission";
import { formatMoney } from "@/lib/i18n";

/**
 * A creator's balances, one block per currency.
 *
 * Extracted from the earnings page so the multi-currency case can be tested
 * without a browser and without a seeded creator. Verifying it live would mean
 * writing commission rows for a real merchant, and the local Supabase that
 * would otherwise host a fake one needs Docker, which does not start here.
 */
export function CreatorBalances({
  balances,
}: {
  balances: [CurrencyCode, CreatorBalance][];
}) {
  if (balances.length === 0) {
    return (
      <Panel className="mb-5 px-3.5 py-3">
        <p className="text-[13px] text-ink-soft">
          Nothing earned yet. Your first sale through one of your links will show up here.
        </p>
      </Panel>
    );
  }

  // One currency is the common case and must look exactly as it did before the
  // split, so the heading only appears once there is something to tell apart.
  const showCurrencyHeadings = balances.length > 1;

  return (
    <>
      {balances.map(([currency, balance]) => (
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
    </>
  );
}
