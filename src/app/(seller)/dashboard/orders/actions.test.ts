import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  canTransitionOrder: vi.fn(),
  enqueueIntegrationEvent: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/commerce/transitions", () => ({ canTransitionOrder: mocks.canTransitionOrder }));
vi.mock("@/lib/integrations/events", () => ({ enqueueIntegrationEvent: mocks.enqueueIntegrationEvent }));

import { bulkOrderStatusAction } from "./actions";

function formData(values: Record<string, string | string[]>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((v) => data.append(key, v));
    else data.set(key, value);
  });
  return data;
}

const ACTIVE_SELLER = {
  kind: "seller" as const, authenticated: true, userId: "u1", email: "seller@example.com",
  sellerAccountId: "seller-1", country: "GH" as const, status: "active" as const,
};

const SUSPENDED_SELLER = { ...ACTIVE_SELLER, status: "suspended" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canTransitionOrder.mockReturnValue(true);
});

describe("bulkOrderStatusAction", () => {
  it("does nothing when the seller account is suspended", async () => {
    mocks.resolveServerActor.mockResolvedValue(SUSPENDED_SELLER);
    const from = vi.fn();
    mocks.createAdminClient.mockReturnValue({ from });

    await bulkOrderStatusAction(formData({ orderIds: ["order-1"], status: "cancelled" }));

    expect(from).not.toHaveBeenCalled();
  });

  it("calls finalize_order_stock with 'consumed' when bulk-completing orders", async () => {
    mocks.resolveServerActor.mockResolvedValue(ACTIVE_SELLER);
    const rpc = vi.fn().mockResolvedValue({});
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: "order-1" } });
    const updateEq2 = vi.fn().mockReturnValue({ select: () => ({ maybeSingle: updateMaybeSingle }) });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });
    const selectIn = vi.fn().mockResolvedValue({ data: [{ id: "order-1", status: "processing", event_version: 1, payment_status: "paid" }] });
    const selectEq = vi.fn().mockReturnValue({ in: selectIn });
    const select = vi.fn().mockReturnValue({ eq: selectEq });
    const from = vi.fn((table: string) => (table === "orders" ? { select, update } : {}));
    mocks.createAdminClient.mockReturnValue({ from, rpc });

    await bulkOrderStatusAction(formData({ orderIds: ["order-1"], status: "completed" }));

    expect(rpc).toHaveBeenCalledWith("finalize_order_stock", { p_order_id: "order-1", p_outcome: "consumed" });
  });
});
