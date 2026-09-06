import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

// The server-only package throws unconditionally outside webpack, and the
// supabase client is built inside this module rather than injected.
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";

import { getPublicProducts, STOREFRONT_PAGE_SIZE } from "./queries";

/**
 * `?page=abc` reached this as NaN, `Math.max(1, NaN)` stayed NaN, and
 * `.range(NaN, NaN)` returned no rows — so a buyer following a shared link with
 * a mangled query string saw an empty shop. No error, nothing to suggest the
 * shop had stock. Verified against production before the fix: `?page=abc`
 * rendered zero products on a shop that has one.
 */

type Row = { id: string };

/** Records the range asked for and serves that many rows. */
function clientReturning(available: number) {
  const seen: { from: number; to: number }[] = [];
  const rows = (from: number, to: number): Row[] =>
    Array.from({ length: Math.max(0, Math.min(available - from, to - from + 1)) }, (_, i) => ({
      id: `p-${from + i}`,
    }));

  const chain: Record<string, unknown> = {};
  let range = { from: 0, to: 0 };
  for (const method of ["select", "eq", "order", "ilike", "in", "maybeSingle"]) {
    chain[method] = () => chain;
  }
  chain.range = (from: number, to: number) => {
    range = { from, to };
    seen.push({ from, to });
    return chain;
  };
  chain.then = (onfulfilled: (value: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve(onfulfilled({ data: rows(range.from, range.to), error: null }));

  mocks.createClient.mockReturnValue({ from: () => chain });
  return seen;
}

describe("getPublicProducts", () => {
  it("treats a page that is not a number as page one", async () => {
    const seen = clientReturning(5);

    const { products } = await getPublicProducts("shop-1", {
      page: Number("abc"),
    });

    expect(seen[0].from).toBe(0);
    expect(products.length).toBeGreaterThan(0);
  });

  it.each([[0], [-3], [1.5], [Number.POSITIVE_INFINITY]])(
    "treats %s as page one rather than as no rows",
    async (page) => {
      const seen = clientReturning(5);

      const { products } = await getPublicProducts("shop-1", { page });

      expect(seen[0].from).toBe(0);
      expect(products).toHaveLength(5);
    },
  );

  it("asks for one row more than it shows, to know whether a next page exists", async () => {
    const seen = clientReturning(100);

    const { products, hasNext } = await getPublicProducts("shop-1", { page: 1 });

    expect(seen[0]).toEqual({ from: 0, to: STOREFRONT_PAGE_SIZE });
    // The extra row is not shown to the buyer.
    expect(products).toHaveLength(STOREFRONT_PAGE_SIZE);
    expect(hasNext).toBe(true);
  });

  it("reports no next page on the last one", async () => {
    clientReturning(STOREFRONT_PAGE_SIZE);

    const { products, hasNext } = await getPublicProducts("shop-1", { page: 1 });

    expect(products).toHaveLength(STOREFRONT_PAGE_SIZE);
    expect(hasNext).toBe(false);
  });

  it("offsets by whole pages", async () => {
    const seen = clientReturning(100);

    await getPublicProducts("shop-1", { page: 3 });

    expect(seen[0].from).toBe(STOREFRONT_PAGE_SIZE * 2);
  });
});
