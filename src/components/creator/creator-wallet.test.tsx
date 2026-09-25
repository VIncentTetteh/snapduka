import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { formatMoney } from "@snapduka/core";
import { CreatorWalletBalances, CreatorWithdrawals } from "./creator-wallet";
import type { CreatorWallet } from "@/lib/creators/wallet";

function wallet(over: Partial<CreatorWallet> = {}): CreatorWallet {
  return { currency: "GHS", pendingMinor: 0, availableMinor: 0, reservedMinor: 0, inArrears: false, ...over };
}

describe("CreatorWalletBalances", () => {
  it("shows withdrawable, held and in-flight money as separate figures", () => {
    render(
      <CreatorWalletBalances
        wallets={[wallet({ availableMinor: 12_000, pendingMinor: 3_000, reservedMinor: 5_000 })]}
      />,
    );
    expect(screen.getByText(formatMoney(12_000, "GHS"))).toBeInTheDocument();
    expect(screen.getByText(formatMoney(3_000, "GHS"))).toBeInTheDocument();
    expect(screen.getByText(formatMoney(5_000, "GHS"))).toBeInTheDocument();
    // One currency looks like a single wallet, with no heading to tell apart.
    expect(screen.queryByText("GHS balance")).not.toBeInTheDocument();
  });

  it("keeps each currency in its own block", () => {
    render(
      <CreatorWalletBalances
        wallets={[wallet({ availableMinor: 1_000 }), wallet({ currency: "NGN", availableMinor: 50_000 })]}
      />,
    );
    expect(screen.getByText("GHS balance")).toBeInTheDocument();
    expect(screen.getByText("NGN balance")).toBeInTheDocument();
    expect(screen.getAllByText("Ready to withdraw")).toHaveLength(2);
  });

  it("explains a negative balance as a debt that nets off, not a bill", () => {
    render(<CreatorWalletBalances wallets={[wallet({ availableMinor: -600, inArrears: true })]} />);
    expect(screen.getByRole("note")).toHaveTextContent(`${formatMoney(600, "GHS")} is owed back`);
    expect(screen.getByRole("note")).toHaveTextContent("comes off your next commission");
  });
});

describe("CreatorWithdrawals", () => {
  it("renders nothing before the first withdrawal", () => {
    const { container } = render(<CreatorWithdrawals withdrawals={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says why a withdrawal failed", () => {
    render(
      <CreatorWithdrawals
        withdrawals={[
          {
            id: "p1",
            reference: "PO-ABC12345",
            amount_minor: 6_000,
            fee_minor: 100,
            currency: "GHS",
            status: "failed",
            failure_reason: "Account closed",
            review_reason: null,
            created_at: "2026-09-25T10:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(/Account closed/)).toBeInTheDocument();
  });
});
