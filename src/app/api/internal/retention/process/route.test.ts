import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isInternalJobRequest: vi.fn(),
  createAdminClient: vi.fn(),
  sendEmail: vi.fn(),
  sendWhatsApp: vi.fn(),
}));

vi.mock("@/lib/internal-jobs/auth", () => ({ isInternalJobRequest: mocks.isInternalJobRequest }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notifications/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/notifications/whatsapp", () => ({ sendWhatsApp: mocks.sendWhatsApp }));
vi.mock("@/lib/app-url", () => ({ appOrigin: async () => "https://snapduka.test" }));

import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/internal/retention/process", { method: "POST" });
}

type Row = { id: string } & Record<string, unknown>;

/**
 * A chainable, thenable query-builder mock. Every filter returns the chain;
 * awaiting it serves a keyset page, so the route's paging is exercised for
 * real rather than being short-circuited by a mock that resolves too early.
 */
function pagedTable(rows: Row[], onPage?: (ids: string[]) => void) {
  return () => {
    let cursor: string | null = null;
    let size = rows.length;
    const chain: Record<string, unknown> = {};
    for (const method of ["is", "eq", "lte", "gte", "not", "order"]) {
      chain[method] = () => chain;
    }
    chain.limit = (n: number) => {
      size = n;
      return chain;
    };
    chain.gt = (_column: string, value: string) => {
      cursor = value;
      return chain;
    };
    chain.then = (onfulfilled: (value: { data: Row[]; error: unknown }) => unknown) => {
      const after = cursor;
      const page = (after ? rows.filter((row) => row.id > after) : rows).slice(0, size);
      onPage?.(page.map((row) => row.id));
      return Promise.resolve(onfulfilled({ data: page, error: null }));
    };
    return chain;
  };
}

function adminMock(tables: Record<string, { rows: Row[]; onPage?: (ids: string[]) => void }>, updateSpy = vi.fn()) {
  return {
    from: (table: string) => ({
      select: pagedTable(tables[table]?.rows ?? [], tables[table]?.onPage),
      update: (payload: unknown) => {
        updateSpy(table, payload);
        const chain: Record<string, unknown> = {};
        for (const method of ["eq", "is"]) chain[method] = () => chain;
        chain.then = (onfulfilled: (value: { data: null; error: null }) => unknown) =>
          Promise.resolve(onfulfilled({ data: null, error: null }));
        return chain;
      },
    }),
  };
}

const inStock = (id: string): Row => ({
  id,
  email: `${id}@buyer.test`,
  phone: null,
  products: {
    id: `prod-${id}`,
    name: "Kente wrapper",
    inventory_policy: "track",
    stock_quantity: 5,
    reserved_quantity: 0,
    shops: { slug: "shop" },
  },
});

const outOfStock = (id: string): Row => ({
  ...inStock(id),
  products: { ...(inStock(id).products as object), stock_quantity: 0, reserved_quantity: 0 },
});

describe("POST /api/internal/retention/process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInternalJobRequest.mockReturnValue(true);
    mocks.sendEmail.mockResolvedValue({ delivered: true });
    mocks.sendWhatsApp.mockResolvedValue({ delivered: true });
  });

  it("rejects unauthorized requests", async () => {
    mocks.isInternalJobRequest.mockReturnValue(false);
    expect((await POST(request())).status).toBe(401);
  });

  /**
   * The bug this route carried. A restock request whose product is still
   * unavailable is skipped and keeps `notified_at` null, so it matches again on
   * every subsequent run. The read took the first 100 with no ordering, so a
   * hundred permanently-unavailable products at the head filled the page every
   * time and every alert behind them was never sent — while the job reported
   * success.
   */
  it("notifies a request behind a hundred permanently-unavailable ones", async () => {
    const blocked = Array.from({ length: 120 }, (_, i) => outOfStock(`a-${String(i).padStart(3, "0")}`));
    const reachable = inStock("z-ready");

    mocks.createAdminClient.mockReturnValue(
      adminMock({ restock_requests: { rows: [...blocked, reachable] }, abandoned_checkouts: { rows: [] } }),
    );

    const body = await (await POST(request())).json();

    expect(body.restocks).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      "z-ready@buyer.test",
      expect.stringContaining("back in stock"),
      expect.stringContaining("https://snapduka.test/shop/products/prod-z-ready"),
    );
  });

  it("does not alert for a product that is still out of stock", async () => {
    mocks.createAdminClient.mockReturnValue(
      adminMock({ restock_requests: { rows: [outOfStock("r-1")] }, abandoned_checkouts: { rows: [] } }),
    );

    const body = await (await POST(request())).json();

    expect(body.restocks).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("reads past the first page of abandoned checkouts", async () => {
    const pages: string[][] = [];
    const carts = Array.from({ length: 250 }, (_, i) => ({
      id: `c-${String(i).padStart(4, "0")}`,
      contact: `buyer-${i}@test`,
      cart_snapshot: { lines: [] },
      campaign_token: null,
      shops: { slug: "shop", display_name: "Shop" },
    }));

    mocks.createAdminClient.mockReturnValue(
      adminMock({
        abandoned_checkouts: { rows: carts, onPage: (ids) => pages.push(ids) },
        restock_requests: { rows: [] },
      }),
    );

    const body = await (await POST(request())).json();

    expect(body.reminders).toBe(250);
    // More than one read: a single 50-row page would have stopped at 50.
    expect(pages.length).toBeGreaterThan(1);
  });

  it("keeps going when one reminder fails to send", async () => {
    mocks.sendEmail
      .mockResolvedValueOnce({ delivered: false, reason: "bounced" })
      .mockResolvedValue({ delivered: true });

    const carts = ["c-1", "c-2"].map((id) => ({
      id,
      contact: `${id}@test`,
      cart_snapshot: { lines: [] },
      campaign_token: null,
      shops: { slug: "shop", display_name: "Shop" },
    }));

    mocks.createAdminClient.mockReturnValue(
      adminMock({ abandoned_checkouts: { rows: carts }, restock_requests: { rows: [] } }),
    );

    const body = await (await POST(request())).json();
    expect(body.reminders).toBe(1);
  });
});
