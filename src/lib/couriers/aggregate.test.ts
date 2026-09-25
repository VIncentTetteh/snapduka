// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveQuotingAdapters: vi.fn(),
  loadCourierCredentials: vi.fn(),
  tables: {} as Record<string, { data: unknown; error: unknown }>,
  inserted: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/couriers/registry", () => ({ resolveQuotingAdapters: mocks.resolveQuotingAdapters }));
vi.mock("@/lib/couriers/credentials", () => ({ loadCourierCredentials: mocks.loadCourierCredentials }));

/**
 * A chainable stand-in for the Supabase query builder: every filter returns
 * itself, and awaiting it (or .maybeSingle()) yields the table's canned result.
 * Inserts into courier_quotes echo rows back with ids, like the real table.
 */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const result = () => mocks.tables[table] ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gt", "order", "limit"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve(result());
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
      builder.insert = (rows: Record<string, unknown>[]) => {
        mocks.inserted.push(...rows);
        const echoed = rows.map((row, index) => ({ id: `q${index + 1}`, ...row }));
        return { select: () => Promise.resolve({ data: echoed, error: null }) };
      };
      return builder;
    },
  }),
}));

import { CourierAdapterError, type CourierAdapter } from "@snapduka/core";

import { createSandboxAdapter } from "./adapters/sandbox";
import { cacheKey, fanOut, quoteDelivery, toDeliveryAddress } from "./aggregate";

const SHOP = { id: "shop-1", seller_account_id: "seller-1", country: "GH", currency: "GHS", status: "published" };
const METHODS = [
  { id: "fm-1", type: "delivery", name: "Accra delivery", fee_minor: 2000, position: 0 },
  { id: "fm-2", type: "pickup", name: "Pick up in Osu", fee_minor: 0, position: 1 },
];
const PICKUP = { address: { line1: "1 Ring Rd", area: "Osu", city: "Accra", region: "Greater Accra" } };
const NOW = () => new Date("2026-09-25T10:00:00Z");

const input = { shopId: "shop-1", destination: { city: "Accra", area: "East Legon" }, parcelValueMinor: 10_000 };

function hangingAdapter(id: string): CourierAdapter {
  return {
    ...createSandboxAdapter({ enabled: true }),
    id,
    quote: () => new Promise(() => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserted.length = 0;
  mocks.tables = {
    shops: { data: SHOP, error: null },
    fulfillment_methods: { data: METHODS, error: null },
    shop_pickup_addresses: { data: PICKUP, error: null },
    country_configs: { data: { delivery_margin_bps: 1000 }, error: null },
    courier_quotes: { data: [], error: null },
  };
  mocks.loadCourierCredentials.mockResolvedValue(null);
});

describe("quoteDelivery", () => {
  it("returns the seller's own methods when no courier is switched on", async () => {
    mocks.resolveQuotingAdapters.mockResolvedValue([]);

    const result = await quoteDelivery(input, { now: NOW });

    expect(result).toMatchObject({ ok: true, courierNote: "no_couriers_enabled", currency: "GHS" });
    if (!result.ok) throw new Error("unreachable");
    expect(result.options).toEqual([
      { kind: "seller_method", fulfillmentMethodId: "fm-1", type: "delivery", label: "Accra delivery", feeMinor: 2000, currency: "GHS" },
      { kind: "seller_method", fulfillmentMethodId: "fm-2", type: "pickup", label: "Pick up in Osu", feeMinor: 0, currency: "GHS" },
    ]);
  });

  it("refuses an unpublished or unknown shop", async () => {
    mocks.tables.shops = { data: null, error: null };
    expect(await quoteDelivery(input)).toEqual({ ok: false, reason: "shop_not_found" });
  });

  it("does not ask couriers without a pickup address", async () => {
    const sandbox = createSandboxAdapter({ enabled: true });
    const quote = vi.spyOn(sandbox, "quote");
    mocks.resolveQuotingAdapters.mockResolvedValue([sandbox]);
    mocks.tables.shop_pickup_addresses = { data: null, error: null };

    const result = await quoteDelivery(input, { now: NOW });

    expect(result).toMatchObject({ ok: true, courierNote: "no_pickup_address" });
    expect(quote).not.toHaveBeenCalled();
  });

  it("adds the delivery margin to live quotes and caches them", async () => {
    mocks.resolveQuotingAdapters.mockResolvedValue([createSandboxAdapter({ enabled: true, now: NOW })]);

    const result = await quoteDelivery(input, { now: NOW });
    if (!result.ok) throw new Error("expected ok");

    const couriers = result.options.filter((option) => option.kind === "courier");
    // Sandbox standard is 1500; 10% margin -> 1650.
    expect(couriers[0]).toMatchObject({ courierId: "sandbox", service: "standard", feeMinor: 1650, quoteId: "q1" });
    expect(result.options.filter((option) => option.kind === "seller_method")).toHaveLength(2);
    expect(mocks.inserted[0]).toMatchObject({
      provider: "sandbox",
      amount_minor: 1500,
      margin_minor: 150,
      shop_id: "shop-1",
      seller_account_id: "seller-1",
      expires_at: "2026-09-25T10:15:00.000Z",
    });
    expect(String(mocks.inserted[0].cache_key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("serves a cache hit without asking the courier again", async () => {
    const sandbox = createSandboxAdapter({ enabled: true });
    const quote = vi.spyOn(sandbox, "quote");
    mocks.resolveQuotingAdapters.mockResolvedValue([sandbox]);
    mocks.tables.courier_quotes = {
      data: [
        { id: "cached-1", provider: "sandbox", service: "standard", service_label: "Std", amount_minor: 1500,
          margin_minor: 100, currency: "GHS", eta_minutes: 60, expires_at: "2026-09-25T10:10:00Z" },
        // Its flag has since been switched off: must not be shown.
        { id: "cached-2", provider: "yango", service: "bike", service_label: "Bike", amount_minor: 900,
          margin_minor: 0, currency: "GHS", eta_minutes: 30, expires_at: "2026-09-25T10:10:00Z" },
      ],
      error: null,
    };

    const result = await quoteDelivery(input, { now: NOW });
    if (!result.ok) throw new Error("expected ok");

    expect(result.cached).toBe(true);
    expect(quote).not.toHaveBeenCalled();
    expect(result.options.filter((option) => option.kind === "courier")).toEqual([
      expect.objectContaining({ quoteId: "cached-1", feeMinor: 1600 }),
    ]);
  });
});

describe("fanOut", () => {
  const request = {
    sellerAccountId: "seller-1",
    shopId: "shop-1",
    country: "GH" as const,
    currency: "GHS" as const,
    pickup: toDeliveryAddress({ city: "Accra" }, "GH"),
    dropoff: toDeliveryAddress({ city: "Accra" }, "GH"),
    parcel: { valueMinor: 1000 },
  };

  it("drops a courier that does not answer in time and keeps the rest", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const quotes = await fanOut([hangingAdapter("slow"), createSandboxAdapter({ enabled: true })], request, 20);
    expect(quotes.map((quote) => quote.courierId)).toEqual(["sandbox", "sandbox"]);
  });

  it("drops a courier that fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: CourierAdapter = {
      ...createSandboxAdapter({ enabled: true }),
      id: "broken",
      quote: () => Promise.reject(new CourierAdapterError("broken", "unavailable", "down")),
    };
    expect(await fanOut([failing], request, 50)).toEqual([]);
  });

  it("drops quotes an adapter makes for another courier or currency", async () => {
    const liar: CourierAdapter = {
      ...createSandboxAdapter({ enabled: true }),
      id: "liar",
    };
    expect(await fanOut([liar], request, 50)).toEqual([]);
  });

  it("does not ask a courier without COD to quote a cash-on-delivery order", async () => {
    const noCod = createSandboxAdapter({ enabled: true });
    const quote = vi.spyOn(noCod, "quote");
    const adapter: CourierAdapter = { ...noCod, capabilities: { ...noCod.capabilities, cod: false } };
    expect(await fanOut([adapter], { ...request, codAmountMinor: 5000 }, 50)).toEqual([]);
    expect(quote).not.toHaveBeenCalled();
  });
});

describe("cacheKey", () => {
  it("ignores case and spacing but not the destination", () => {
    const a = cacheKey("s", toDeliveryAddress({ city: "Accra ", area: "Osu" }, "GH"), input);
    const b = cacheKey("s", toDeliveryAddress({ city: "accra", area: "OSU" }, "GH"), input);
    const c = cacheKey("s", toDeliveryAddress({ city: "Kumasi", area: "Osu" }, "GH"), input);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
