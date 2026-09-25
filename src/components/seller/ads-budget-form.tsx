"use client";

import { useActionState } from "react";

import { moveBudgetAction, type AdsActionState } from "@/app/(seller)/dashboard/ads/actions";
import { Panel } from "@/components/ui/surface";
import { FormActionButton } from "@/components/ui/submit-button";
import { formatMoney, type CurrencyCode } from "@snapduka/core";

type Props = {
  currency: CurrencyCode;
  prepaidMinor: number;
  availableMinor: number;
  minTopUpMinor: number | null;
  /**
   * Rendered by the server so it survives hydration unchanged. The action hands
   * back the next one after each successful move (see AdsActionState.nextKey).
   */
  initialKey: string;
};

/**
 * Adds money to the ad budget from the available balance, or moves unused
 * budget back. Owner only; the page does not render this for team members and
 * the action refuses them regardless.
 */
export function AdsBudgetForm({ currency, prepaidMinor, availableMinor, minTopUpMinor, initialKey }: Props) {
  const initial: AdsActionState = { status: "idle", nextKey: initialKey };
  const [state, action] = useActionState(moveBudgetAction, initial);
  const key = state.nextKey || initialKey;

  return (
    <Panel className="p-4.5">
      <h2 className="mb-1 text-[14px] font-bold">Ad budget</h2>
      <p className="mb-3 text-[12.5px] leading-[1.6] text-ink-soft">
        Prepaid from your available balance ({formatMoney(availableMinor, currency)} now). Unused budget can be moved
        back at any time.
        {minTopUpMinor ? ` The smallest top-up is ${formatMoney(minTopUpMinor, currency)}.` : ""}
      </p>
      {/* Keyed on the idempotency key so the amount clears after a successful move. */}
      <form key={key} action={action} className="grid gap-2.5">
        <input type="hidden" name="idempotencyKey" value={key} />
        <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="ads-budget-amount">
          Amount ({currency})
          <input
            id="ads-budget-amount"
            name="amount"
            inputMode="decimal"
            required
            className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <FormActionButton
            name="direction"
            value="top_up"
            pendingLabel="Adding…"
            className="min-h-10 cursor-pointer rounded-[9px] border-none bg-ink px-4 text-[13px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
          >
            Add to budget
          </FormActionButton>
          {prepaidMinor > 0 ? (
            <FormActionButton
              name="direction"
              value="withdraw"
              pendingLabel="Moving…"
              className="min-h-10 cursor-pointer rounded-[9px] border border-line bg-white px-4 text-[13px] font-bold text-ink disabled:cursor-wait disabled:opacity-60"
            >
              Move back to balance
            </FormActionButton>
          ) : null}
        </div>
      </form>
      {state.status !== "idle" && state.message ? (
        <p className={`mt-2.5 text-[12.5px] ${state.status === "error" ? "text-danger" : "text-ink-soft"}`} role="status">
          {state.message}
        </p>
      ) : null}
    </Panel>
  );
}
