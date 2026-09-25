"use client";

import { useActionState, useState } from "react";

import {
  requestCreatorPayoutAction,
  saveCreatorPayoutDestinationAction,
  type CreatorPayoutActionState,
} from "@/app/creator/(portal)/payments/actions";
import { Panel } from "@/components/ui/surface";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney, type CurrencyCode } from "@snapduka/core";
import type { WithdrawBlocker } from "@/lib/creators/wallet";

const inputClass =
  "h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent";
const buttonClass =
  "min-h-10 cursor-pointer justify-self-start rounded-[9px] border-none bg-ink px-4 text-[13px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60";

function StateMessage({ state }: { state: CreatorPayoutActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p className={`mt-2.5 text-[12.5px] ${state.status === "error" ? "text-danger" : "text-ink-soft"}`} role="status">
      {state.message}
    </p>
  );
}

/**
 * The creator's withdraw form. Mirrors the seller's PayoutRequestForm: it only
 * avoids offering an action that cannot succeed. The amount is validated by
 * request_creator_payout under a lock on the wallet, whose messages are shown
 * verbatim.
 */
export function CreatorWithdrawForm({
  availableMinor,
  currency,
  minimumMinor,
  feeMinor,
  blocker,
  destinationLabel,
}: {
  availableMinor: number;
  currency: CurrencyCode;
  minimumMinor: number;
  feeMinor: number;
  blocker: WithdrawBlocker | null;
  destinationLabel: string | null;
}) {
  const [state, action] = useActionState(requestCreatorPayoutAction, {
    status: "idle",
    values: { amount: "" },
  } satisfies CreatorPayoutActionState);

  const blockedMessage: Record<WithdrawBlocker, string> = {
    paused: "Withdrawals are paused right now. Your balance is safe and nothing is lost.",
    no_destination: "Add a mobile money number or bank account below before you can withdraw.",
    cooling_off: "New payout details take 24 hours to activate. This protects your account.",
    in_flight: "You already have a withdrawal on its way. You can ask for the next one once it lands.",
    below_minimum: `You need at least ${formatMoney(Math.max(minimumMinor, feeMinor + 1), currency)} available to withdraw.`,
  };

  return (
    <Panel className="p-4.5">
      <h2 className="mb-1 text-[14px] font-bold">Withdraw</h2>
      <p className="mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
        {destinationLabel ? `Money goes to ${destinationLabel}. ` : ""}A {formatMoney(feeMinor, currency)} fee is
        taken from each withdrawal, and it goes out in the next daily batch (09:00 GMT).
      </p>

      {blocker ? (
        <p className="rounded-[10px] bg-raised px-3.5 py-3 text-[12.5px] text-ink-soft">{blockedMessage[blocker]}</p>
      ) : (
        <form action={action} className="grid gap-2.5">
          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="creator-payout-amount">
            Amount ({currency})
            <input
              id="creator-payout-amount"
              name="amount"
              inputMode="decimal"
              required
              defaultValue={state.values.amount}
              placeholder={String(currency === "XOF" ? availableMinor : (availableMinor / 100).toFixed(2))}
              className={inputClass}
            />
          </label>
          <p className="text-[11.5px] text-ink-muted">{formatMoney(availableMinor, currency)} available</p>
          <SubmitButton className={buttonClass} pendingLabel="Requesting…">
            Withdraw
          </SubmitButton>
        </form>
      )}
      <StateMessage state={state} />
    </Panel>
  );
}

/**
 * Where a creator's withdrawals go. The account number is sent to Paystack to
 * confirm the holder's name and exchange for a recipient code; it is never
 * stored, and the action deliberately never returns it, so a failed submit
 * cannot echo it back into this form.
 */
export function CreatorDestinationForm({
  currentLabel,
  currentAccountName,
  coolingOff,
}: {
  currentLabel: string | null;
  currentAccountName: string | null;
  /** Computed on the server with the database clock. */
  coolingOff: boolean;
}) {
  const [state, action] = useActionState(saveCreatorPayoutDestinationAction, {
    status: "idle",
    values: { bankCode: "", bankName: "", type: "mobile_money" },
  } satisfies CreatorPayoutActionState);
  const [open, setOpen] = useState(!currentLabel);
  const [type, setType] = useState(state.values.type ?? "mobile_money");

  return (
    <Panel className="p-4.5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-bold">Where you get paid</h2>
        {currentLabel && !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="cursor-pointer border-none bg-transparent p-0 text-[12.5px] font-semibold text-accent underline-offset-2 hover:underline"
          >
            Change
          </button>
        ) : null}
      </div>

      <p className="mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
        {currentLabel
          ? `${currentAccountName ? `${currentAccountName} · ` : ""}${currentLabel}${
              coolingOff ? " · New details are still activating. Withdrawals open 24 hours after a change." : ""
            }`
          : "Add a mobile money number or bank account so SnapDuka can send you what you earn."}
      </p>

      {open ? (
        <form action={action} className="grid gap-2.5">
          <div className="flex gap-2" role="group" aria-label="Destination type">
            {(
              [
                { id: "mobile_money", label: "Mobile money" },
                { id: "bank", label: "Bank account" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setType(option.id)}
                aria-pressed={type === option.id}
                className={`min-h-9 flex-1 cursor-pointer rounded-[9px] border px-3 text-[12.5px] font-semibold transition-colors ${
                  type === option.id ? "border-ink bg-ink text-white" : "border-line bg-raised text-ink-soft hover:bg-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input name="type" type="hidden" value={type} />

          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="creator-dest-bank-name">
            {type === "mobile_money" ? "Network (MTN, Vodafone, AirtelTigo)" : "Bank name"}
            <input id="creator-dest-bank-name" name="bankName" required defaultValue={state.values.bankName} className={inputClass} />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="creator-dest-bank-code">
            {type === "mobile_money" ? "Network code" : "Bank code"}
            <input id="creator-dest-bank-code" name="bankCode" required defaultValue={state.values.bankCode} className={inputClass} />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="creator-dest-account">
            {type === "mobile_money" ? "Mobile money number" : "Account number"}
            <input id="creator-dest-account" name="accountNumber" inputMode="numeric" autoComplete="off" required className={inputClass} />
          </label>
          <p className="text-[11.5px] leading-[1.5] text-ink-muted">
            We check the name on the account with Paystack before saving. SnapDuka never stores this number.
          </p>
          <SubmitButton className={buttonClass} pendingLabel="Checking…">
            Save details
          </SubmitButton>
        </form>
      ) : null}
      <StateMessage state={state} />
    </Panel>
  );
}
