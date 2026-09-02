import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CreatorBalances } from "./creator-balances";
import type { CreatorBalance } from "@/lib/creators/commission";

// The rendering half of the multi-currency fix. The arithmetic is covered in
// src/lib/creators/commission.test.ts; this covers what a creator actually sees,
// which otherwise could only be checked by writing commission rows for a real
// merchant in production.
// Found by /qa on 2026-09-02

function balance(over: Partial<CreatorBalance> = {}): CreatorBalance {
  return {
    pendingMinor: 0,
    payableMinor: 0,
    paidMinor: 0,
    reversedMinor: 0,
    owedNowMinor: 0,
    carryOverMinor: 0,
    ...over,
  };
}

describe("CreatorBalances", () => {
  it("shows one block per currency, each with its own money", () => {
    render(
      <CreatorBalances
        balances={[
          ["GHS", balance({ owedNowMinor: 24_000 })],
          ["NGN", balance({ owedNowMinor: 500_000 })],
        ]}
      />,
    );

    expect(screen.getByText("GHS earnings")).toBeInTheDocument();
    expect(screen.getByText("NGN earnings")).toBeInTheDocument();
    // Three tiles per currency, so six in total — never one merged figure.
    expect(screen.getAllByText("Ready to be paid")).toHaveLength(2);
    // The bug this replaces rendered a single 524,000 under one currency label.
    expect(screen.queryByText(/524,000/)).not.toBeInTheDocument();
  });

  it("adds no currency heading when there is only one", () => {
    render(<CreatorBalances balances={[["GHS", balance({ owedNowMinor: 24_000 })]]} />);

    expect(screen.queryByText("GHS earnings")).not.toBeInTheDocument();
    expect(screen.getAllByText("Ready to be paid")).toHaveLength(1);
  });

  it("tells a creator who has earned nothing what to expect", () => {
    render(<CreatorBalances balances={[]} />);

    expect(screen.getByText(/Nothing earned yet/)).toBeInTheDocument();
    expect(screen.queryByText("Ready to be paid")).not.toBeInTheDocument();
  });

  it("surfaces a negative carry-over in its own currency", () => {
    render(
      <CreatorBalances
        balances={[
          ["GHS", balance({ carryOverMinor: -4_000 })],
          ["NGN", balance({ owedNowMinor: 1_000 })],
        ]}
      />,
    );

    const carryOver = screen.getByText(/carried over from a/);
    expect(carryOver).toBeInTheDocument();
    // Shown as a positive amount being deducted, not as a negative balance.
    expect(carryOver.textContent).toMatch(/40/);
    expect(screen.getAllByText(/carried over/)).toHaveLength(1);
  });
});
