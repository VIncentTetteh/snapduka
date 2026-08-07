import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  enqueueIntegrationEvent: vi.fn(),
}));

// The state machine is deliberately NOT mocked: it is pure, it comes from
// @snapduka/core, and asserting against the real allowed-transition table is
// the point — a stubbed guard would let this suite pass on a transition the
// database would reject.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/integrations/events", () => ({
  enqueueIntegrationEvent: mocks.enqueueIntegrationEvent,
}));

import { isSellerTransition } from "@/lib/commerce/transitions";
import { bulkTransitionOrders, transitionOrder } from "./transition";

const SELLER = "seller-1";
const ORDER_ID = "order-1";

type OrderRow = {
  id: string;
  status: string;
  event_version: number;
  payment_status: string;
  customer_id?: string | null;
  public_reference?: string;
  total_minor?: number;
  currency?: string;
};

/**
 * A fake admin client that behaves like PostgREST rather than replaying one
 * fixed call chain: it applies the accumulated `.eq()` filters to an in-memory
 * orders table. That matters here because the whole point of this module is the
 * compare-and-set on `event_version` — a mock that ignores filters would report
 * success for a write that never happened.
 */
function fakeAdmin(rows: OrderRow[]) {
  const state = new Map(rows.map((r) => [r.id, { ...r }]));
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const inserted: { table: string; row: Record<string, unknown> }[] = [];

  function ordersTable() {
    let filters: [string, unknown][] = [];
    let updates: Record<string, unknown> | null = null;
    let ids: string[] | null = null;

    const matches = (row: OrderRow) =>
      filters.every(([column, value]) => (row as Record<string, unknown>)[column] === value);

    const builder = {
      select: () => builder,
      update: (values: Record<string, unknown>) => {
        updates = values;
        return builder;
      },
      eq(column: string, value: unknown) {
        // seller_account_id is not stored on the row; treat it as a scope check.
        if (column === "seller_account_id") {
          if (value !== SELLER) filters.push(["__never__", true]);
          return builder;
        }
        filters.push([column, value]);
        return builder;
      },
      in(_column: string, values: string[]) {
        ids = values;
        return builder;
      },
      async maybeSingle() {
        const row = [...state.values()].find(matches) ?? null;
        if (!updates) return { data: row, error: null };
        if (!row) return { data: null, error: null };
        Object.assign(state.get(row.id)!, updates);
        return { data: { id: row.id }, error: null };
      },
      then(resolve: (v: { data: OrderRow[]; error: null }) => unknown) {
        const data = [...state.values()].filter(
          (row) => matches(row) && (!ids || ids.includes(row.id)),
        );
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    filters = [];
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
                return { data: null, error: null };
              },
            },
    },
    rpc,
    inserted,
    state,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

function paidOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    status: "processing",
    event_version: 3,
    payment_status: "paid",
    customer_id: "cust-1",
    public_reference: "SD-ABC",
    total_minor: 5000,
    currency: "GHS",
    ...overrides,
  };
}

describe("isSellerTransition", () => {
  it("accepts the four seller-driven statuses", () => {
    for (const status of ["confirmed", "processing", "completed", "cancelled"]) {
      expect(isSellerTransition(status)).toBe(true);
    }
  });

  it("rejects statuses only the system sets", () => {
    expect(isSellerTransition("draft")).toBe(false);
    expect(isSellerTransition("pending")).toBe(false);
    expect(isSellerTransition("")).toBe(false);
  });
});

describe("transitionOrder", () => {
  it("advances the order and bumps the version", async () => {
    const admin = fakeAdmin([paidOrder()]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await transitionOrder({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "completed",
      expectedVersion: 3,
    });

    expect(result).toEqual({ ok: true, orderId: ORDER_ID, status: "completed", version: 4 });
    expect(admin.state.get(ORDER_ID)).toMatchObject({
      status: "completed",
      event_version: 4,
      fulfillment_status: "fulfilled",
    });
  });

  it("reports a conflict when the caller's version is stale", async () => {
    const admin = fakeAdmin([paidOrder({ event_version: 7 })]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await transitionOrder({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "completed",
      expectedVersion: 3,
    });

    expect(result).toEqual({ ok: false, reason: "version_conflict" });
    expect(admin.state.get(ORDER_ID)!.status).toBe("processing");
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("refuses a transition the state machine disallows", async () => {
    // processing -> confirmed is backwards; the real table has no such edge.
    const admin = fakeAdmin([paidOrder()]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await transitionOrder({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "confirmed",
      expectedVersion: 3,
    });

    expect(result).toEqual({ ok: false, reason: "illegal_transition" });
    expect(admin.state.get(ORDER_ID)!.status).toBe("processing");
  });

  it("refuses to reopen a completed order", async () => {
    const admin = fakeAdmin([paidOrder({ status: "completed" })]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await transitionOrder({
      sellerAccountId: SELLER,
      orderId: ORDER_ID,
      next: "processing",
      expectedVersion: 3,
    });

    expect(result).toEqual({ ok: false, reason: "illegal_transition" });
  });

  it("reports not_found for another seller's order", async () => {
    const admin = fakeAdmin([paidOrder()]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const result = await transitionOrder({
      sellerAccountId: "someone-else",
      orderId: ORDER_ID,
      next: "completed",
      expectedVersion: 3,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  describe("offline payment", () => {
    it("will not complete an offline_due order without explicit confirmation", async () => {
      const admin = fakeAdmin([paidOrder({ payment_status: "offline_due" })]);
      mocks.createAdminClient.mockReturnValue(admin.client);

      const result = await transitionOrder({
        sellerAccountId: SELLER,
        orderId: ORDER_ID,
        next: "completed",
        expectedVersion: 3,
      });

      expect(result).toEqual({ ok: false, reason: "offline_unconfirmed" });
      expect(admin.state.get(ORDER_ID)!.payment_status).toBe("offline_due");
    });

    it("marks it paid once the seller confirms cash was collected", async () => {
      const admin = fakeAdmin([paidOrder({ payment_status: "offline_due" })]);
      mocks.createAdminClient.mockReturnValue(admin.client);

      const result = await transitionOrder({
        sellerAccountId: SELLER,
        orderId: ORDER_ID,
        next: "completed",
        expectedVersion: 3,
        offlinePaidConfirmed: true,
      });

      expect(result.ok).toBe(true);
      expect(admin.state.get(ORDER_ID)).toMatchObject({
        status: "completed",
        payment_status: "paid",
      });
    });
  });

  describe("side effects", () => {
    it("consumes reserved stock and notifies the buyer on completion", async () => {
      const admin = fakeAdmin([paidOrder()]);
      mocks.createAdminClient.mockReturnValue(admin.client);

      await transitionOrder({
        sellerAccountId: SELLER,
        orderId: ORDER_ID,
        next: "completed",
        expectedVersion: 3,
      });

      expect(admin.rpc).toHaveBeenCalledWith("finalize_order_stock", {
        p_order_id: ORDER_ID,
        p_outcome: "consumed",
      });
      expect(admin.rpc).toHaveBeenCalledWith("enqueue_order_notification", {
        p_order_id: ORDER_ID,
        p_event: "completed",
      });
      expect(admin.inserted).toContainEqual(
        expect.objectContaining({
          table: "order_events",
          row: expect.objectContaining({ event_type: "order_completed" }),
        }),
      );
      expect(mocks.enqueueIntegrationEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "order.completed",
          eventId: `${ORDER_ID}:4:completed`,
        }),
      );
    });

    it("releases reserved stock on cancellation and raises no integration event", async () => {
      const admin = fakeAdmin([paidOrder()]);
      mocks.createAdminClient.mockReturnValue(admin.client);

      await transitionOrder({
        sellerAccountId: SELLER,
        orderId: ORDER_ID,
        next: "cancelled",
        expectedVersion: 3,
      });

      expect(admin.rpc).toHaveBeenCalledWith("finalize_order_stock", {
        p_order_id: ORDER_ID,
        p_outcome: "released",
      });
      expect(mocks.enqueueIntegrationEvent).not.toHaveBeenCalled();
    });

    it("moves fulfilment in step with status", async () => {
      for (const [from, next, fulfillment] of [
        ["pending", "confirmed", "confirmed"],
        ["confirmed", "processing", "preparing"],
        ["pending", "cancelled", "cancelled"],
      ] as const) {
        const admin = fakeAdmin([paidOrder({ status: from, event_version: 1 })]);
        mocks.createAdminClient.mockReturnValue(admin.client);

        await transitionOrder({
          sellerAccountId: SELLER,
          orderId: ORDER_ID,
          next,
          expectedVersion: 1,
        });

        expect(admin.state.get(ORDER_ID)!).toMatchObject({ fulfillment_status: fulfillment });
      }
    });
  });
});

describe("bulkTransitionOrders", () => {
  it("applies the full single-order behaviour to every order", async () => {
    // The previous bulk path wrote only status and event_version, so buyers were
    // never told and fulfilment_status went stale. Bulk must not be a shortcut.
    const admin = fakeAdmin([
      paidOrder({ id: "a", event_version: 1 }),
      paidOrder({ id: "b", event_version: 5 }),
    ]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const outcomes = await bulkTransitionOrders({
      sellerAccountId: SELLER,
      orderIds: ["a", "b"],
      next: "completed",
    });

    expect(outcomes.every((o) => o.result.ok)).toBe(true);
    expect(admin.state.get("a")).toMatchObject({ event_version: 2, fulfillment_status: "fulfilled" });
    expect(admin.state.get("b")).toMatchObject({ event_version: 6, fulfillment_status: "fulfilled" });
    expect(admin.rpc).toHaveBeenCalledWith("enqueue_order_notification", {
      p_order_id: "a",
      p_event: "completed",
    });
    expect(admin.rpc).toHaveBeenCalledWith("enqueue_order_notification", {
      p_order_id: "b",
      p_event: "completed",
    });
  });

  it("reports per-order failures instead of aborting the batch", async () => {
    const admin = fakeAdmin([paidOrder({ id: "a", event_version: 1 })]);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const outcomes = await bulkTransitionOrders({
      sellerAccountId: SELLER,
      orderIds: ["a", "missing"],
      next: "cancelled",
    });

    expect(outcomes).toEqual([
      { orderId: "a", result: expect.objectContaining({ ok: true }) },
      { orderId: "missing", result: { ok: false, reason: "not_found" } },
    ]);
  });

  it("caps the batch at 100 orders", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `o${i}`);
    const admin = fakeAdmin(ids.map((id) => paidOrder({ id, event_version: 1 })));
    mocks.createAdminClient.mockReturnValue(admin.client);

    const outcomes = await bulkTransitionOrders({
      sellerAccountId: SELLER,
      orderIds: ids,
      next: "cancelled",
    });

    expect(outcomes).toHaveLength(100);
  });
});
