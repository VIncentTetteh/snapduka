import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const tables: Record<string, unknown> = {
  seller_trust_scores: {
    score: 82,
    tier: "gold",
    components: { verification: 25, refundRate: 15, inputs: { ageDays: 400 } },
    computed_at: "2026-09-25T04:40:00Z",
    weights_version: "v1",
  },
  kyc_checks: [
    { id: "k1", provider: "sandbox", check_type: "ghana_card", status: "passed", match_score: 97,
      masked_id: "GHA-*******89-0", failure_reason: null, created_at: "2026-09-24T10:00:00Z" },
  ],
  risk_signals: [
    { id: "r1", signal_type: "payout_velocity", score: 40, context: "payout_request", state: "open",
      rules_version: "2026-09-25.1", created_at: "2026-09-24T11:00:00Z" },
  ],
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) builder[method] = () => builder;
      builder.maybeSingle = () => Promise.resolve({ data: tables[table] ?? null, error: null });
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve);
      return builder;
    },
  }),
}));

import { SellerTrustPanel } from "./seller-trust-panel";

describe("SellerTrustPanel", () => {
  it("shows the score breakdown, masked checks and risk signals", async () => {
    render(await SellerTrustPanel({ sellerId: "seller-1" }));
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText(/Verification:/)).toBeInTheDocument();
    // Nested inputs are not a component and are not listed as one.
    expect(screen.queryByText(/inputs/)).toBeNull();
    expect(screen.getByText(/GHA-\*{7}89-0/)).toBeInTheDocument();
    expect(screen.getByText("payout_velocity")).toBeInTheDocument();
  });
});
