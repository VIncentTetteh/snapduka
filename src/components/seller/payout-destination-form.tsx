"use client";

import { useActionState, useState } from "react";

import {
  savePayoutDestinationAction,
  type DestinationActionState,
} from "@/app/(seller)/dashboard/payouts/actions";
import { Panel } from "@/components/ui/surface";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: DestinationActionState = {
  status: "idle",
  values: { bankCode: "", bankName: "", type: "mobile_money" },
};

type Props = {
  currentLabel: string | null;
  currentAccountName: string | null;
  /** Computed on the server — the render must stay pure. */
  coolingOff: boolean;
};

/**
 * Where a seller's withdrawals go.
 *
 * The account number is typed here and sent straight to Paystack in exchange
 * for a recipient code — it is never stored, never logged, and never echoed
 * back into this form on error, which is why the action's returned values omit
 * it deliberately.
 */
export function PayoutDestinationForm({ currentLabel, currentAccountName, coolingOff }: Props) {
  const [state, action] = useActionState(savePayoutDestinationAction, initialState);
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

      {currentLabel ? (
        <p className="mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
          {currentAccountName ? `${currentAccountName} · ` : ""}
          {currentLabel}
          {coolingOff
            ? " · New details are still activating. Withdrawals open 24 hours after a change."
            : ""}
        </p>
      ) : (
        <p className="mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
          Add a mobile money number or bank account so you can withdraw your balance.
        </p>
      )}

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
                  type === option.id
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-raised text-ink-soft hover:bg-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input name="type" type="hidden" value={type} />

          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="dest-bank-name">
            {type === "mobile_money" ? "Network (MTN, Vodafone, AirtelTigo)" : "Bank name"}
            <input
              id="dest-bank-name"
              name="bankName"
              required
              defaultValue={state.values.bankName}
              className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>

          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="dest-bank-code">
            {type === "mobile_money" ? "Network code" : "Bank code"}
            <input
              id="dest-bank-code"
              name="bankCode"
              required
              defaultValue={state.values.bankCode}
              className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>

          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="dest-account">
            {type === "mobile_money" ? "Mobile money number" : "Account number"}
            <input
              id="dest-account"
              name="accountNumber"
              inputMode="numeric"
              autoComplete="off"
              required
              className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
          <p className="text-[11.5px] leading-[1.5] text-ink-muted">
            SnapDuka never stores this number — it goes straight to Paystack, which returns a
            reference we use to send your money.
          </p>

          <SubmitButton
            className="min-h-10 cursor-pointer justify-self-start rounded-[9px] border-none bg-ink px-4 text-[13px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
            pendingLabel="Saving…"
          >
            Save details
          </SubmitButton>
        </form>
      ) : null}

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
