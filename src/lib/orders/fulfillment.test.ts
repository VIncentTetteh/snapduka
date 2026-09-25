import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

// The fulfilment state machine is deliberately not mocked, for the same reason
// as in transition.test.ts: the real edge table is what is under test.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { advanceFulfillment } from "./fulfillment";

const SELLER = "seller-1";
const ORDER_ID = "order-1";

type OrderRow = {
  id: string;
  status?: string;
  fulfillment_status: string;
  event_version: number;
  protection_mode?: string;
};

/** PostgREST-shaped fake that honours `.eq()` filters, so the CAS is real. */
function fakeAdmin(rows: OrderRow[], failures: { event?: boolean; notify?: boolean } = {}) {
  const state = new Map(rows.map((r) => [r.id, { ...r }]));
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: null, error: failures.notify ? { message: "boom" } : null });
  const inserted: { table: string; row: Record<string, unknown> }[] = [];

  function ordersTable() {
    const filters: [string, unknown][] = [];
    let updates: Record<string, unknown> | null = null;
    const matches = (row: OrderRow) =>
      filters.every(([column, value]) => (row as Record<string, unknown>)[column] === value);
    const builder = {
      select: () => builder,
      update: (values: Record<string, unknown>) => {
        updates = values;
        return builder;
      },
      eq(column: string, value: unknown) {
        if (column === "seller_account_id") {
          if (value !== SELLER) filters.push(["__never__", true]);
          return builder;
        }
        filters.push([column, value]);
        return builder;
      },
      async maybeSingle() {
        const row = [...state.values()].find(matches) ?? null;
        if (!updates) return { data: row, error: null };
        if (!row) return { data: null, error: null };
        Object.assign(state.get(row.id)!, updates);
        return { data: { id: row.id }, error: null };
      },
    };
    return builder;
  }

  return {
    client: {
      rpc,
      from: (table: string) =>
        table === "orders"
          ? ordersTable()
          : {
              insert: async (row: Record<string, unknown>) => {
                inserted.push({ table, row });
                return { data: null, error: failures.event ? { message: "boom" } : null };
              },
            },
    },
    rpc,
    inserted,
    state,
  };
}

function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return { id: ORDER_ID, fulfillment_status: "preparing", event_version: 3, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("advanceFulfillment", () => {
  it("dispatches, bumps the version, records a buyer-visible event and notifies", async () => {
    const admin = fakeAdmin([order()]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await advanceFulfillment({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "dispatched",
      expectedVersion: 3,
      source: "api",
    });

    expect(result).toEqual({ ok: true, orderId: ORDER_ID, fulfillmentStatus: "dispatched", version: 4 });
    expect(admin.state.get(ORDER_ID)).toMatchObject({
      fulfillment_status: "dispatched",
      event_version: 4,
    });
    expect(admin.inserted).toEqual([
      {
        table: "order_events",
        row: expect.objectContaining({
          order_id: ORDER_ID,
          seller_account_id: SELLER,
          event_type: "fulfillment_dispatched",
          actor_type: "seller",
          actor_id: SELLER,
          buyer_visible: true,
          data: { from: "preparing", to: "dispatched", source: "api" },
        }),
      },
    ]);
    expect(admin.rpc).toHaveBeenCalledWith("enqueue_order_notification", {
      p_order_id: ORDER_ID,
      p_event: "dispatched",
    });
  });

  it("reports a conflict on a stale version and writes nothing", async () => {
    const admin = fakeAdmin([order({ event_version: 9 })]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await advanceFulfillment({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "dispatched",
      expectedVersion: 3,
      source: "api",
    });

    expect(result).toEqual({ ok: false, reason: "version_conflict" });
    expect(admin.state.get(ORDER_ID)!.fulfillment_status).toBe("preparing");
    expect(admin.inserted).toEqual([]);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("refuses to dispatch an order whose payment is not yet confirmed", async () => {
    const admin = fakeAdmin([order({ fulfillment_status: "unconfirmed" })]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await advanceFulfillment({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "dispatched",
      expectedVersion: 3,
      source: "api",
    });

    expect(result).toEqual({ ok: false, reason: "illegal_transition" });
    expect(admin.state.get(ORDER_ID)!.fulfillment_status).toBe("unconfirmed");
  });

  it("does not find another seller's order", async () => {
    const admin = fakeAdmin([order()]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await advanceFulfillment({
      sellerAccountId: "someone-else",
      orderId: ORDER_ID,
      next: "dispatched",
      expectedVersion: 3,
      source: "api",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("keeps a committed transition successful when post-commit side effects fail", async () => {
    const admin = fakeAdmin([order()], { event: true, notify: true });
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await advanceFulfillment({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "dispatched",
      expectedVersion: 3,
      source: "api",
    });

    expect(result.ok).toBe(true);
    // Loud, not silent: both failures must reach the logs.
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("lets a courier report delivery, attributed to the provider, without a version", async () => {
    const admin = fakeAdmin([order({ fulfillment_status: "dispatched" })]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await advanceFulfillment({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "fulfilled",
      source: "courier",
      detail: { trackingNumber: "TRK1", provider: "yango" },
    });

    expect(result).toEqual({ ok: true, orderId: ORDER_ID, fulfillmentStatus: "fulfilled", version: 4 });
    expect(admin.inserted[0]!.row).toMatchObject({
      actor_type: "provider",
      actor_id: null,
      data: { from: "dispatched", to: "fulfilled", source: "courier", trackingNumber: "TRK1" },
    });
  });

  it.each(["api", "dashboard", "mobile"] as const)(
    "refuses a %s caller claiming delivery; sellers complete the order instead",
    async (source) => {
      const admin = fakeAdmin([order({ fulfillment_status: "dispatched" })]);
      mocks.createAdminClient.mockReturnValue(admin.client);

      const result = await advanceFulfillment({
        sellerAccountId: SELLER,
        orderId: ORDER_ID,
        next: "fulfilled",
        expectedVersion: 3,
        source,
      });

      expect(result).toEqual({ ok: false, reason: "illegal_transition" });
      expect(admin.state.get(ORDER_ID)!.fulfillment_status).toBe("dispatched");
    },
  );

  it("treats a paid (confirmed) order with unconfirmed fulfilment as dispatchable", async () => {
    const admin = fakeAdmin([order({ status: "confirmed", fulfillment_status: "unconfirmed" })]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await advanceFulfillment({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "dispatched",
      expectedVersion: 3,
      source: "booking",
    });

    expect(result.ok).toBe(true);
    expect(admin.inserted[0]!.row).toMatchObject({ data: expect.objectContaining({ from: "unconfirmed" }) });
  });

  it("records a courier's delivery on a protected order as evidence, without fulfilling it", async () => {
    const admin = fakeAdmin([order({ fulfillment_status: "dispatched", protection_mode: "protect" })]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await advanceFulfillment({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "fulfilled",
      source: "courier",
    });

    expect(result).toEqual({ ok: false, reason: "protect_awaiting_buyer" });
    expect(admin.rpc).toHaveBeenCalledWith("record_courier_delivery", { p_order_id: ORDER_ID });
    expect(admin.state.get(ORDER_ID)!.fulfillment_status).toBe("dispatched");
  });
});
