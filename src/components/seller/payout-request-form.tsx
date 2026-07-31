"use client";

import { useActionState } from "react";

import { requestPayoutAction, type PayoutActionState } from "@/app/(seller)/dashboard/payouts/actions";
import { Panel } from "@/components/ui/surface";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/i18n";
import type { CurrencyCode } from "@/lib/countries/types";

const initialState: PayoutActionState = { status: "idle", values: { amount: "" } };

type Props = {
  availableMinor: number;
  currency: CurrencyCode;
  minimumMinor: number;
  feeMinor: number;
  hasDestination: boolean;
  payoutsEnabled: boolean;
  destinationLabel: string | null;
};

/**
 * The withdraw form.
 *
 * Deliberately does not re-implement the eligibility rules — the amount is
 * validated by request_seller_payout under a lock on the wallet row, and its
 * error messages are written for sellers and surfaced verbatim. Everything
 * here is about not offering an action that cannot succeed.
 */
export function PayoutRequestForm({
  availableMinor,
  currency,
  minimumMinor,
  feeMinor,
  hasDestination,
  payoutsEnabled,
  destinationLabel,
}: Props) {
  const [state, action] = useActionState(requestPayoutAction, initialState);

  const blocked =
    !payoutsEnabled
      ? "Withdrawals are paused right now. Your balance is safe and nothing is lost."
      : !hasDestination
        ? "Add a bank account or mobile money number below before you can withdraw."
        : availableMinor < minimumMinor
          ? `You need at least ${formatMoney(minimumMinor, currency)} to withdraw.`
          : null;

  return (
    <Panel className="p-4.5">
      <h2 className="mb-1 text-[14px] font-bold">Withdraw</h2>
      <p className="mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
        {destinationLabel
          ? `Money goes to ${destinationLabel}. A ${formatMoney(feeMinor, currency)} fee is taken from each withdrawal.`
          : `A ${formatMoney(feeMinor, currency)} fee is taken from each withdrawal.`}
      </p>

      {blocked ? (
        <p className="rounded-[10px] bg-raised px-3.5 py-3 text-[12.5px] text-ink-soft">{blocked}</p>
      ) : (
        <form action={action} className="grid gap-2.5">
          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="payout-amount">
            Amount ({currency})
            <input
              id="payout-amount"
              name="amount"
              inputMode="decimal"
              required
              defaultValue={state.values.amount}
              placeholder={String(
                currency === "XOF" ? availableMinor : (availableMinor / 100).toFixed(2),
              )}
              className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
          </label>
          <p className="text-[11.5px] text-ink-muted">
            {formatMoney(availableMinor, currency)} available
          </p>
          <SubmitButton
            className="min-h-10 cursor-pointer justify-self-start rounded-[9px] border-none bg-ink px-4 text-[13px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
            pendingLabel="Requesting…"
          >
            Withdraw
          </SubmitButton>
        </form>
      )}

      {state.status !== "idle" && state.message ? (
        <p
          className={`mt-2.5 text-[12.5px] ${
            state.status === "error" ? "text-danger" : "text-ink-soft"
          }`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </Panel>
  );
}
