import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  revalidatePath: vi.fn(),
  transitionOrder: vi.fn(),
  bulkTransitionOrders: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
// redirect() throws in Next, which is how a server action stops. Reproducing
// that here is what lets a test assert the refusal was *spoken* rather than
// only that nothing happened.
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
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
 *
 * Every refusal below used to be a bare `return`. The version conflict is the
 * one that bites in normal use — two tabs, or a page left open while the order
 * moved on — and "Mark complete" simply did nothing, which reads as a broken
 * button. So these tests assert two things per refusal: the transition is not
 * attempted, and the seller is told why.
 */

/** The message a refusal redirected with, or null if it did not refuse. */
async function refusalFrom(run: () => Promise<unknown>): Promise<string | null> {
  mocks.redirect.mockClear();
  try {
    await run();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("NEXT_REDIRECT:")) throw error;
  }
  const call = mocks.redirect.mock.calls.at(-1);
  if (!call) return null;
  const url = String(call[0]);
  const query = url.split("?")[1] ?? "";
  return new URLSearchParams(query).get("error");
}

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

    await refusalFrom(() =>
      updateOrderAction(formData({ orderId: "order-1", status: "completed", version: "1" })),
    );

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  // The whole point of the change: a stale page must say so, not sit there.
  it("tells the seller to reload when the order moved underneath them", async () => {
    mocks.transitionOrder.mockResolvedValue({ ok: false, reason: "version_conflict" });

    const message = await refusalFrom(() =>
      updateOrderAction(formData({ orderId: "order-1", status: "completed", version: "1" })),
    );

    expect(message).toMatch(/reload/i);
  });

  it.each([
    ["not_found", /could not be found/i],
    ["illegal_transition", /cannot move/i],
    ["offline_unconfirmed", /payment received/i],
  ])("explains a %s refusal", async (reason, expected) => {
    mocks.transitionOrder.mockResolvedValue({ ok: false, reason });

    const message = await refusalFrom(() =>
      updateOrderAction(formData({ orderId: "order-1", status: "completed", version: "1" })),
    );

    expect(message).toMatch(expected);
  });

  it.each([
    ["a suspended seller", { ...ACTIVE_SELLER, status: "suspended" as const }],
    ["an anonymous visitor", { kind: "anonymous" as const, authenticated: false }],
    ["a role without orders.manage", { ...ACTIVE_SELLER, role: "analyst" as const }],
  ])("refuses %s, out loud", async (_label, actor) => {
    mocks.resolveServerActor.mockResolvedValue(actor);

    const message = await refusalFrom(() =>
      updateOrderAction(formData({ orderId: "order-1", status: "completed", version: "1" })),
    );

    expect(mocks.transitionOrder).not.toHaveBeenCalled();
    expect(message).toBeTruthy();
  });

  it.each([
    ["a status only the system sets", { orderId: "order-1", status: "pending", version: "1" }],
    ["a missing status", { orderId: "order-1", version: "1" }],
    ["a non-numeric version", { orderId: "order-1", status: "completed", version: "abc" }],
  ])("rejects %s without calling the transition, and says so", async (_label, values) => {
    const message = await refusalFrom(() => updateOrderAction(formData(values)));

    expect(mocks.transitionOrder).not.toHaveBeenCalled();
    expect(message).toBeTruthy();
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

  it("refuses a suspended seller, out loud", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...ACTIVE_SELLER, status: "suspended" });

    const message = await refusalFrom(() =>
      bulkOrderStatusAction(formData({ orderIds: ["order-1"], status: "cancelled" })),
    );

    expect(mocks.bulkTransitionOrders).not.toHaveBeenCalled();
    expect(message).toBeTruthy();
  });

  it("says so when nothing is selected", async () => {
    const message = await refusalFrom(() =>
      bulkOrderStatusAction(formData({ status: "cancelled" })),
    );

    expect(mocks.bulkTransitionOrders).not.toHaveBeenCalled();
    expect(message).toMatch(/select at least one/i);
  });

  // Partly succeeding is the normal case when one order moved underneath the
  // seller. Reporting the whole batch as done would hide it.
  it("reports how many orders in a batch were refused", async () => {
    mocks.bulkTransitionOrders.mockResolvedValue([
      { orderId: "order-1", result: { ok: true, orderId: "order-1", status: "cancelled", version: 2 } },
      { orderId: "order-2", result: { ok: false, reason: "version_conflict" } },
    ]);

    const message = await refusalFrom(() =>
      bulkOrderStatusAction(formData({ orderIds: ["order-1", "order-2"], status: "cancelled" })),
    );

    expect(message).toMatch(/1 of 2/);
    // The successful one still landed.
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/orders");
  });
});
