import { describe, expect, it, vi } from "vitest";

// Regression: ISSUE-006 — Growth, Advanced insights and the Share Studio
// analytics tab counted events with Array.filter over select("event_type"),
// which PostgREST caps at db.max_rows (1000). The demo seller already had
// 2,853 event rows in production, so every conversion rate on those pages was
// computed from a truncated numerator and denominator.
// Found by /qa on 2026-09-01
// Report: .gstack/qa-reports/qa-report-snapduka-2026-09-01.md

const TRUE_COUNTS: Record<string, number> = {
  visit: 975,
  product_view: 1550,
  checkout_start: 328,
};

const eq = vi.fn();
const select = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));

const { fetchEventCounts } = await import("./event-counts");

function wireClient() {
  from.mockReset();
  select.mockReset();
  eq.mockReset();
  from.mockImplementation((table: string) => {
    expect(table).toBe("analytics_events");
    return { select };
  });
  select.mockImplementation((columns: string, options: unknown) => {
    // The whole point: ask the database to count, never stream rows back.
    expect(options).toEqual({ count: "exact", head: true });
    expect(columns).not.toBe("event_type");
    return {
      eq: (_sellerColumn: string, _sellerId: string) => ({
        eq: (_typeColumn: string, eventType: string) =>
          Promise.resolve({ count: TRUE_COUNTS[eventType] ?? 0 }),
      }),
    };
  });
}

describe("fetchEventCounts", () => {
  it("returns true totals above the 1000-row response cap", async () => {
    wireClient();

    const counts = await fetchEventCounts("b7f3c2a1-4d5e-4f60-9a71-8c2d3e4f5a60");

    expect(counts).toEqual({ visit: 975, product_view: 1550, checkout_start: 328 });
    // 2,853 rows in total — a filter over a capped fetch could not have seen them.
    expect(counts.visit + counts.product_view + counts.checkout_start).toBe(2853);
  });

  it("counts every event type the app records", async () => {
    wireClient();

    await fetchEventCounts("seller-1");

    expect(from).toHaveBeenCalledTimes(3);
  });

  it("treats a null count as zero rather than NaN", async () => {
    from.mockReset();
    from.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: null }) }) }),
    });

    const counts = await fetchEventCounts("seller-2");

    expect(counts).toEqual({ visit: 0, product_view: 0, checkout_start: 0 });
  });
});
