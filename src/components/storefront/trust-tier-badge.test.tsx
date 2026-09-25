import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/risk/trust", () => ({ getStorefrontTrustTier: vi.fn() }));

import { TrustTierPill } from "./trust-tier-badge";

describe("TrustTierPill", () => {
  it.each([
    ["bronze", "Bronze seller"],
    ["silver", "Silver seller"],
    ["gold", "Gold seller"],
  ] as const)("labels %s", (tier, label) => {
    render(<TrustTierPill tier={tier} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
