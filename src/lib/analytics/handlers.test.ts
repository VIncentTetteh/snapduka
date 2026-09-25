import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { handlersFor } from "@/lib/events/handlers";

import { recordDeliveryConfirmed } from "./handlers";

const delivered = (payload: unknown) => ({
  id: 7,
  aggregate: "order",
  aggregate_id: "order-1",
  event_type: "protect.delivered",
  payload: payload as never,
  attempts: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: "event-id", error: null });
});

describe("analytics outbox handlers", () => {
  it("registers delivery_confirmed on protect.delivered", () => {
    expect(handlersFor("protect.delivered")).toContain(recordDeliveryConfirmed);
  });

  it("records delivery_confirmed for the order with the confirmation method", async () => {
    await recordDeliveryConfirmed(delivered({ orderId: "order-1", method: "buyer_code", inspectionEndsAt: "x" }));
    expect(mocks.rpc).toHaveBeenCalledWith("record_order_analytics_event", {
      p_event_type: "delivery_confirmed",
      p_order_id: "order-1",
      p_dimensions: { method: "buyer_code" },
    });
  });

  it("copies only a known method, never arbitrary payload keys", async () => {
    await recordDeliveryConfirmed(delivered({ method: "<script>", phone: "+233201234567" }));
    expect(mocks.rpc).toHaveBeenCalledWith("record_order_analytics_event", expect.objectContaining({ p_dimensions: {} }));
    await recordDeliveryConfirmed(delivered(null));
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "record_order_analytics_event",
      expect.objectContaining({ p_dimensions: {} }),
    );
  });

  it("throws on failure so the outbox retries (the write is idempotent)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(recordDeliveryConfirmed(delivered({ method: "auto" }))).rejects.toThrow(/boom/);
  });
});
