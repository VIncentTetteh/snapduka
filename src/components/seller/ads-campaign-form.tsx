"use client";

import { useActionState, useState } from "react";

import { createCampaignAction, type AdsActionState } from "@/app/(seller)/dashboard/ads/actions";
import { Panel } from "@/components/ui/surface";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney, type CurrencyCode } from "@snapduka/core";

const initialState: AdsActionState = { status: "idle" };

type Props = {
  currency: CurrencyCode;
  products: { id: string; name: string; priceMinor: number }[];
  maxProducts: number;
  minBidMinor: number;
  maxBidMinor: number;
  minDailyBudgetMinor: number;
  maxDailyBudgetMinor: number;
};

/** Major units for an input's placeholder: XOF has no minor unit. */
function major(minor: number, currency: CurrencyCode): string {
  return currency === "XOF" ? String(minor) : (minor / 100).toFixed(2);
}

/**
 * New campaign. The ranges shown come from the market's ad policy; the
 * database re-checks all of them, so this only avoids offering choices that
 * cannot succeed (e.g. more products than a campaign may hold).
 */
export function AdsCampaignForm({
  currency,
  products,
  maxProducts,
  minBidMinor,
  maxBidMinor,
  minDailyBudgetMinor,
  maxDailyBudgetMinor,
}: Props) {
  const [state, action] = useActionState(createCampaignAction, initialState);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Clear the selection once a campaign is created (React resets the
  // uncontrolled name field itself), so a second click cannot re-create it.
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.status === "success") setSelected(new Set());
  }
  const full = selected.size >= maxProducts;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  if (!products.length) {
    return (
      <Panel className="p-4.5">
        <h2 className="mb-1 text-[14px] font-bold">New campaign</h2>
        <p className="text-[12.5px] leading-[1.6] text-ink-soft">
          Publish an active product first; only live products can be promoted.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="p-4.5">
      <h2 className="mb-1 text-[14px] font-bold">New campaign</h2>
      <form action={action} className="grid gap-3">
        <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="ads-campaign-name">
          Name
          <input
            id="ads-campaign-name"
            name="name"
            required
            maxLength={80}
            className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>

        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-[12px] font-semibold text-ink">
            Products ({selected.size} of up to {maxProducts})
          </legend>
          <div className="grid max-h-56 gap-1 overflow-y-auto rounded-[9px] border border-line-input bg-white p-2">
            {products.map((product) => {
              const checked = selected.has(product.id);
              return (
                <label key={product.id} className="flex items-center justify-between gap-3 text-[12.5px] text-ink">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="productId"
                      value={product.id}
                      checked={checked}
                      disabled={!checked && full}
                      onChange={(event) => toggle(product.id, event.target.checked)}
                    />
                    {product.name}
                  </span>
                  <span className="text-ink-muted">{formatMoney(product.priceMinor, currency)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="ads-campaign-bid">
            Pay per click ({currency})
            <input
              id="ads-campaign-bid"
              name="bid"
              inputMode="decimal"
              required
              placeholder={major(minBidMinor, currency)}
              className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
            <span className="text-[11.5px] font-normal text-ink-muted">
              {formatMoney(minBidMinor, currency)} to {formatMoney(maxBidMinor, currency)}
            </span>
          </label>
          <label className="grid gap-1 text-[12px] font-semibold text-ink" htmlFor="ads-campaign-budget">
            Daily budget ({currency})
            <input
              id="ads-campaign-budget"
              name="dailyBudget"
              inputMode="decimal"
              required
              placeholder={major(minDailyBudgetMinor, currency)}
              className="h-10 w-full rounded-[9px] border border-line-input bg-white px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
            <span className="text-[11.5px] font-normal text-ink-muted">
              {formatMoney(minDailyBudgetMinor, currency)} to {formatMoney(maxDailyBudgetMinor, currency)}
            </span>
          </label>
        </div>

        <SubmitButton
          disabled={selected.size === 0}
          className="min-h-10 cursor-pointer justify-self-start rounded-[9px] border-none bg-ink px-4 text-[13px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
          pendingLabel="Creating…"
        >
          Create campaign
        </SubmitButton>
      </form>
      {state.status !== "idle" && state.message ? (
        <p className={`mt-2.5 text-[12.5px] ${state.status === "error" ? "text-danger" : "text-ink-soft"}`} role="status">
          {state.message}
        </p>
      ) : null}
    </Panel>
  );
}
