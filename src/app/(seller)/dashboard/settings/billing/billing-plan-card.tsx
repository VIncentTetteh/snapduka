"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Panel } from "@/components/ui/surface";
import { formatMoney } from "@/lib/i18n";
import type { CurrencyCode } from "@/lib/countries/types";

import { changePlan } from "./actions";

type Interval = "monthly" | "yearly";
type Price = { id: string; interval: string; amount_minor: number; currency: string };

const TIER: Record<string, number> = { free: 0, growth: 1, scale: 2 };

export function BillingPlanCard({
  code,
  name,
  prices,
  features,
  currentPlanCode,
  currentInterval,
  isEntitled,
  renewsAt,
  featured,
  pending,
  pendingLabel,
}: {
  code: string;
  name: string;
  prices: Price[];
  features: string[];
  currentPlanCode: string;
  currentInterval: string;
  isEntitled: boolean;
  renewsAt: string | null;
  featured: boolean;
  pending: boolean;
  pendingLabel: string | null;
}) {
  const monthly = prices.find((price) => price.interval === "monthly");
  const yearly = prices.find((price) => price.interval === "yearly");
  const initialInterval: Interval =
    currentPlanCode === code && currentInterval === "yearly" && yearly ? "yearly" : monthly ? "monthly" : "yearly";
  const [interval, setInterval] = useState<Interval>(initialInterval);
  const selected = interval === "yearly" ? yearly : monthly;
  const isCurrentPlan = currentPlanCode === code;
  const isCurrentSelection = isEntitled && isCurrentPlan && currentInterval === interval;
  const isTierUpgrade = !isEntitled || TIER[code] > TIER[currentPlanCode];
  const isIntervalUpgrade = isEntitled && isCurrentPlan && currentInterval === "monthly" && interval === "yearly";
  const appliesNow = isTierUpgrade || isIntervalUpgrade;
  const yearlySavings = monthly && yearly ? Math.max(0, monthly.amount_minor * 12 - yearly.amount_minor) : 0;
  const monthlyEquivalent = yearly ? Math.round(yearly.amount_minor / 12) : 0;
  const selectedCurrency = (selected?.currency ?? monthly?.currency ?? yearly?.currency ?? "GHS") as CurrencyCode;

  return (
    <Panel className={`flex h-full flex-col p-4.5 ${featured ? "border-accent shadow-[0_10px_30px_rgba(168,67,26,0.08)]" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-serif text-[20px] font-medium text-ink">{name}</h3>
        {isCurrentPlan ? <Badge tone="accent">Current</Badge> : featured ? <Badge tone="dark">Popular</Badge> : null}
      </div>

      {monthly && yearly ? (
        <div className="mt-4 grid grid-cols-2 rounded-[10px] bg-line-soft p-1" aria-label={`${name} billing interval`}>
          {(["monthly", "yearly"] as const).map((option) => (
            <button
              key={option}
              aria-pressed={interval === option}
              className={`min-h-8 cursor-pointer rounded-lg border-0 px-2 text-[12px] font-bold capitalize transition-colors ${
                interval === option ? "bg-white text-ink shadow-sm" : "bg-transparent text-ink-muted hover:text-ink"
              }`}
              onClick={() => setInterval(option)}
              type="button"
            >
              {option === "monthly" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 min-h-[68px]">
        {selected ? (
          <>
            <p>
              <span className="font-serif text-[27px] font-medium text-ink">{formatMoney(selected.amount_minor, selectedCurrency)}</span>
              <span className="text-[12.5px] text-ink-muted"> / {interval === "yearly" ? "year" : "month"}</span>
            </p>
            {interval === "yearly" ? (
              <p className="mt-1 text-[11.5px] text-ink-muted">
                {formatMoney(monthlyEquivalent, selectedCurrency)} per month
                {yearlySavings > 0 ? <span className="ml-1.5 font-bold text-success">Save {formatMoney(yearlySavings, selectedCurrency)} a year</span> : null}
              </p>
            ) : yearly && yearlySavings > 0 ? (
              <p className="mt-1 text-[11.5px] text-ink-muted">Choose yearly to save {formatMoney(yearlySavings, selectedCurrency)}.</p>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] font-semibold text-warn">Not priced for this billing interval</p>
        )}
      </div>

      <ul className="mt-3 grid list-none gap-1.5 p-0">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-[12.5px] text-ink-soft">
            <span aria-hidden="true" className="mt-0.5 font-bold text-success">✓</span>
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-5">
        {pending ? (
          <p className="rounded-[10px] bg-line-soft px-3 py-2.5 text-center text-[12px] font-semibold text-ink-muted">{pendingLabel}</p>
        ) : isCurrentSelection ? (
          <p className="grid min-h-11 place-items-center rounded-[10px] bg-line-soft text-[13px] font-bold text-ink-muted">Current billing</p>
        ) : selected ? (
          <form action={changePlan} className="grid gap-2">
            <input name="planCode" type="hidden" value={code} />
            <input name="interval" type="hidden" value={interval} />
            <SubmitButton
              className={buttonClasses(featured && appliesNow ? "primary" : "secondary", "md", "w-full")}
              pendingLabel={appliesNow ? "Redirecting to payment…" : "Scheduling…"}
            >
              {appliesNow
                ? `${isEntitled ? "Upgrade" : "Choose"} ${name} · ${interval}`
                : `Switch to ${name} · ${interval}`}
            </SubmitButton>
            <p className="text-center text-[10.5px] leading-[1.4] text-ink-muted">
              {appliesNow ? "Starts after payment is confirmed." : `Takes effect ${renewsAt ?? "at the end of your paid period"}.`}
            </p>
          </form>
        ) : (
          <p className="grid min-h-11 place-items-center rounded-[10px] bg-line-soft text-[13px] font-bold text-ink-muted">Coming to your market soon</p>
        )}
      </div>
    </Panel>
  );
}
