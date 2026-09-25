import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { onDomainEvent, resetDomainEventHandlers } from "./handlers";
import { drainDomainEvents } from "./process";

const event = (id: number, event_type: string) => ({
  id,
  aggregate: "order",
  aggregate_id: "o1",
  event_type,
  payload: {},
  attempts: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetDomainEventHandlers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("drainDomainEvents", () => {
  it("runs handlers and completes each event, isolating failures", async () => {
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "claim_domain_events"
        ? { data: [event(1, "order.a"), event(2, "order.b"), event(3, "order.none")], error: null }
        : { data: null, error: null },
    );
    const seen: number[] = [];
    onDomainEvent("order.a", async (e) => {
      seen.push(e.id);
    });
    onDomainEvent("order.b", async () => {
      throw new Error("provider down");
    });

    const result = await drainDomainEvents();

    expect(result).toEqual({ claimed: 3, processed: 2, failed: 1 });
    expect(seen).toEqual([1]);
    expect(mocks.rpc).toHaveBeenCalledWith("complete_domain_event", { p_id: 1, p_error: undefined });
    expect(mocks.rpc).toHaveBeenCalledWith("complete_domain_event", { p_id: 2, p_error: "provider down" });
    // No handler: processed, not retried forever.
    expect(mocks.rpc).toHaveBeenCalledWith("complete_domain_event", { p_id: 3, p_error: undefined });
  });

  it("throws when the batch cannot be claimed, so the cron run reports failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(drainDomainEvents()).rejects.toThrow("claim_domain_events failed");
  });
});
