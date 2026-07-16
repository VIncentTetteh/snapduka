"use client";

import { useActionState, useState } from "react";

import {
  requestPayoutAction,
  type PayoutActionState,
} from "@/app/(seller)/dashboard/payouts/actions";
import {
  payoutFeeMinor,
  toMinorUnits,
  validatePayoutRequest,
} from "@/lib/payouts/balance";
import { formatMoney } from "@/lib/i18n";
import { Req } from "@/components/ui/required-mark";
import type { CurrencyCode } from "@/lib/countries/types";

const initialState: PayoutActionState = { status: "idle", values: {} };

/** Amount → review (fee breakdown) → confirm flow from the prototype. */
export function PayoutRequestForm({
  availableMinor,
  currency,
  destinationLabel,
}: {
  availableMinor: number;
  currency: CurrencyCode;
  destinationLabel: string | null;
}) {
  const [state, action, pending] = useActionState(requestPayoutAction, initialState);
  const [amount, setAmount] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const amountMinor = toMinorUnits(amount, currency);
  const fee = payoutFeeMinor(currency);

  function startReview() {
    setClientError(null);
    if (amountMinor == null) {
      setClientError("Enter a valid amount.");
      return;
    }
    const validation = validatePayoutRequest({ amountMinor, availableMinor, currency });
    if (!validation.ok) {
      setClientError(validation.error);
      return;
    }
    setReviewing(true);
  }

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="rounded-xl border border-success-line bg-success-tint px-4 py-4 text-center"
      >
        <p className="mb-1 text-[14px] font-bold text-success">Awaiting approval</p>
        <p className="m-0 text-[12.5px] text-[#2E6B54]">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1.5 text-[12.5px] font-semibold text-ink" htmlFor="payout-amount">
        <span>Amount ({currency})<Req /></span>
        <input
          id="payout-amount"
          name="amount"
          inputMode="decimal"
          placeholder={currency === "XOF" ? "e.g. 12000" : "e.g. 250.00"}
          required
          aria-required="true"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value.replace(/[^0-9.]/g, ""));
            setReviewing(false);
            setClientError(null);
          }}
          className="h-11 w-full rounded-[10px] border border-line-input bg-white px-3.5 text-[15px] text-ink outline-none placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]"
        />
        <span className="font-normal text-ink-muted">
          Available: {formatMoney(availableMinor, currency)}
          {destinationLabel ? ` · Paid to ${destinationLabel}` : ""}
        </span>
      </label>

      {reviewing && amountMinor != null ? (
        <div className="grid gap-1.5 rounded-xl border border-line bg-raised px-4 py-3.5 text-[13px]">
          <span className="flex justify-between text-ink-soft">
            <span>Requested</span>
            <span className="font-semibold text-ink">{formatMoney(amountMinor, currency)}</span>
          </span>
          <span className="flex justify-between text-ink-soft">
            <span>Fee</span>
            <span className="font-semibold text-ink">{formatMoney(fee, currency)}</span>
          </span>
          <span className="flex justify-between border-t border-line-soft pt-1.5 font-bold text-ink">
            <span>You receive</span>
            <span>{formatMoney(amountMinor - fee, currency)}</span>
          </span>
        </div>
      ) : null}

      {clientError || state.status === "error" ? (
        <p role="alert" className="m-0 text-[12.5px] font-semibold text-danger">
          {clientError ?? state.message}
        </p>
      ) : null}

      {reviewing ? (
        <div className="flex gap-2.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => setReviewing(false)}
            className="h-11 cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13.5px] font-semibold text-ink"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={pending}
            className="h-11 flex-1 cursor-pointer rounded-[10px] border-none bg-accent text-[14px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
          >
            {pending ? "Submitting…" : "Confirm request"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startReview}
          disabled={availableMinor <= 0}
          className="h-11 cursor-pointer rounded-[10px] border-none bg-accent text-[14px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-45"
        >
          Request payout
        </button>
      )}
    </form>
  );
}
