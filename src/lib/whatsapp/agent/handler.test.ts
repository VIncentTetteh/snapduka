import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ processConversation: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./process", () => ({ processConversation: mocks.processConversation }));

import { handlersFor } from "@/lib/events/handlers";

import "./handler";

describe("whatsapp.inbound handler", () => {
  it("processes the conversation named in the event", async () => {
    const [handler] = handlersFor("whatsapp.inbound");
    await handler({
      id: 1,
      aggregate: "whatsapp",
      aggregate_id: "agg",
      event_type: "whatsapp.inbound",
      payload: { conversationId: "conv-1", messageId: "m1" },
      attempts: 1,
    });
    expect(mocks.processConversation).toHaveBeenCalledWith("conv-1");
  });

  it("falls back to the aggregate id", async () => {
    const [handler] = handlersFor("whatsapp.inbound");
    await handler({ id: 2, aggregate: "whatsapp", aggregate_id: "conv-2", event_type: "whatsapp.inbound", payload: {}, attempts: 1 });
    expect(mocks.processConversation).toHaveBeenCalledWith("conv-2");
  });
});
