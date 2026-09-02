import { describe, expect, it, vi } from "vitest";

// Carries forward the guarantee that ISSUE-006 established: seller analytics are
// counted in the database, never by pulling rows and counting them in
// JavaScript. PostgREST caps a response at db.max_rows (1000), and the demo
// seller was already at 2,853 event rows in production, so a JS count silently
// stopped growing and every rate derived from it drifted.
//
// This replaces src/lib/analytics/event-counts.test.ts. fetchEventCounts was
// itself an interim fix and now has no caller — the summary RPC returns its
// three counts plus the order and buyer totals in one round trip.
// Found by /qa on 2026-09-02

const rpc = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));

const { fetchAnalyticsSummary } = await import("./summary");

describe("fetchAnalyticsSummary", () => {
  it("aggregates in Postgres and never reads rows back", async () => {
    rpc.mockReset();
    from.mockReset();
    rpc.mockResolvedValue({
      data: [
        {
          visits: 975,
          product_views: 1550,
          checkout_starts: 328,
          orders_placed: 40,
          paid_orders: 31,
          paid_total_minor: 620_000,
          distinct_buyers: 25,
          repeat_buyers: 6,
        },
      ],
      error: null,
    });

    const summary = await fetchAnalyticsSummary();

    expect(rpc).toHaveBeenCalledWith("seller_analytics_summary", expect.any(Object));
    // The whole point: no table read, so no 1000-row cap to fall foul of.
    expect(from).not.toHaveBeenCalled();
    expect(summary.visits).toBe(975);
    expect(summary.productViews).toBe(1550);
    expect(summary.paidOrders).toBe(31);
  });

  it("coerces bigint columns, which PostgREST may hand back as strings", async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({
      data: [
        {
          visits: "975",
          product_views: "1550",
          checkout_starts: "328",
          orders_placed: "40",
          paid_orders: "31",
          paid_total_minor: "620000",
          distinct_buyers: "25",
          repeat_buyers: "6",
        },
      ],
      error: null,
    });

    const summary = await fetchAnalyticsSummary();

    // Without the cast a rate like checkoutStarts / visits would concatenate
    // rather than divide, and the funnel would render nonsense.
    expect(summary.visits).toBe(975);
    expect(summary.checkoutStarts / summary.visits).toBeCloseTo(0.3364, 3);
  });

  it("treats an empty result as zeroes rather than NaN", async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [], error: null });

    const summary = await fetchAnalyticsSummary();

    expect(summary).toMatchObject({ visits: 0, paidOrders: 0, repeatBuyers: 0 });
  });

  it("throws rather than reporting a seller zero traffic they actually had", async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(fetchAnalyticsSummary()).rejects.toBeTruthy();
  });
});
