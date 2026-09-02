import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  revalidatePath: vi.fn(),
  transitionOrder: vi.fn(),
  bulkTransitionOrders: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
// Only the impure module is mocked. isSellerTransition comes from
// @/lib/commerce/transitions (re-exported from @snapduka/core) and stays real,
// because rejecting a status a seller may not set is the adapter's own job.
vi.mock("@/lib/orders/transition", () => ({
  transitionOrder: mocks.transitionOrder,
  bulkTransitionOrders: mocks.bulkTransitionOrders,
}));

import { bulkOrderStatusAction, updateOrderAction } from "./actions";

/**
 * These actions are adapters over @/lib/orders/transition: they authorize the
 * caller, parse FormData, and revalidate. The transition rules themselves are
 * covered in lib/orders/transition.test.ts, against a fake that actually
 * enforces filters.
 */

function formData(values: Record<string, string | string[]>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((v) => data.append(key, v));
    else data.set(key, value);
  });
  return data;
}

const ACTIVE_SELLER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "u1",
  email: "seller@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(ACTIVE_SELLER);
  mocks.transitionOrder.mockResolvedValue({
    ok: true,
    orderId: "order-1",
    status: "completed",
    version: 2,
  });
  mocks.bulkTransitionOrders.mockResolvedValue([]);
});

describe("updateOrderAction", () => {
  it("passes the seller, order, target status and version through", async () => {
    await updateOrderAction(
      formData({ orderId: "order-1", status: "completed", version: "1" }),
    );

    expect(mocks.transitionOrder).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      orderId: "order-1",
      next: "completed",
      expectedVersion: 1,
      offlinePaidConfirmed: false,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/orders/order-1");
  });

  it("forwards the offline-paid confirmation checkbox", async () => {
    await updateOrderAction(
      formData({ orderId: "order-1", status: "completed", version: "1", offlinePaid: "yes" }),
    );

    expect(mocks.transitionOrder).toHaveBeenCalledWith(
      expect.objectContaining({ offlinePaidConfirmed: true }),
    );
  });

  it("does not revalidate when the transition failed", async () => {
    mocks.transitionOrder.mockResolvedValue({ ok: false, reason: "version_conflict" });

    await updateOrderAction(
      formData({ orderId: "order-1", status: "completed", version: "1" }),
    );

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["a suspended seller", { ...ACTIVE_SELLER, status: "suspended" as const }],
    ["an anonymous visitor", { kind: "anonymous" as const, authenticated: false }],
    ["a role without orders.manage", { ...ACTIVE_SELLER, role: "analyst" as const }],
  ])("does nothing for %s", async (_label, actor) => {
    mocks.resolveServerActor.mockResolvedValue(actor);

    await updateOrderAction(
      formData({ orderId: "order-1", status: "completed", version: "1" }),
    );

    expect(mocks.transitionOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["a status only the system sets", { orderId: "order-1", status: "pending", version: "1" }],
    ["a missing status", { orderId: "order-1", version: "1" }],
    ["a non-numeric version", { orderId: "order-1", status: "completed", version: "abc" }],
  ])("rejects %s without calling the transition", async (_label, values) => {
    await updateOrderAction(formData(values));

    expect(mocks.transitionOrder).not.toHaveBeenCalled();
  });
});

describe("bulkOrderStatusAction", () => {
  it("passes every selected order through", async () => {
    await bulkOrderStatusAction(
      formData({ orderIds: ["order-1", "order-2"], status: "cancelled" }),
    );

    expect(mocks.bulkTransitionOrders).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      orderIds: ["order-1", "order-2"],
      next: "cancelled",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/orders");
  });

  it("does nothing when the seller account is suspended", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...ACTIVE_SELLER, status: "suspended" });

    await bulkOrderStatusAction(formData({ orderIds: ["order-1"], status: "cancelled" }));

    expect(mocks.bulkTransitionOrders).not.toHaveBeenCalled();
  });

  it("does nothing when nothing is selected", async () => {
    await bulkOrderStatusAction(formData({ status: "cancelled" }));

    expect(mocks.bulkTransitionOrders).not.toHaveBeenCalled();
  });
});
