import { describe, expect, it, vi } from "vitest";

import { fakeMessage, textBlock, toolUseBlock } from "../../ai/testing";

import { FIXTURE_PRODUCTS, fixtureBackend } from "./fixtures";
import { runAgentTurn } from "./loop";

const SYSTEM = [{ type: "text" as const, text: "system" }];
const HISTORY = [{ role: "user" as const, content: "Do you have black sneakers?" }];
const SNEAKERS = FIXTURE_PRODUCTS[0];

function turn(content: Parameters<typeof fakeMessage>[0], stop: "tool_use" | "end_turn" = "end_turn") {
  return { ok: true as const, message: fakeMessage(content, stop) };
}

describe("runAgentTurn", () => {
  it("runs tools, feeds results back in one user message, and returns the reply", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(turn([toolUseBlock("search_catalog", { query: "black sneakers" })], "tool_use"))
      .mockResolvedValueOnce(turn([textBlock("Yes! Black leather sneakers are GH₵450.00.")]));

    const result = await runAgentTurn({ call, system: SYSTEM, history: HISTORY, backend: fixtureBackend(), catalogPrices: [] });

    expect(result).toEqual({
      kind: "reply",
      text: "Yes! Black leather sneakers are GH₵450.00.",
      toolCalls: 1,
      paidOrderConfirmed: false,
    });
    const second = call.mock.calls[1][0];
    expect(second.messages).toHaveLength(3);
    expect(second.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_search_catalog" });
    expect(second.tools.map((tool: { name: string }) => tool.name)).toContain("create_checkout_link");
  });

  // A price no tool returned is not sent: the seller never set it.
  it("hands off instead of sending an invented price", async () => {
    const call = vi.fn().mockResolvedValue(turn([textBlock("I can do GH₵400 for you.")]));
    const result = await runAgentTurn({
      call,
      system: SYSTEM,
      history: HISTORY,
      backend: fixtureBackend(),
      catalogPrices: [SNEAKERS.price],
    });
    expect(result).toMatchObject({ kind: "handoff", reason: "guardrail:unverified_price" });
  });

  it("allows a catalogue price without a tool call", async () => {
    const call = vi.fn().mockResolvedValue(turn([textBlock("They are GH₵450.00.")]));
    const result = await runAgentTurn({
      call,
      system: SYSTEM,
      history: HISTORY,
      backend: fixtureBackend(),
      catalogPrices: [SNEAKERS.price],
    });
    expect(result.kind).toBe("reply");
  });

  it("hands off on a claimed payment", async () => {
    const call = vi.fn().mockResolvedValue(turn([textBlock("Payment received, thank you!")]));
    const result = await runAgentTurn({ call, system: SYSTEM, history: HISTORY, backend: fixtureBackend(), catalogPrices: [] });
    expect(result).toMatchObject({ kind: "handoff", reason: "guardrail:payment_claim" });
  });

  it("stops after 8 tool calls", async () => {
    const call = vi.fn().mockResolvedValue(turn([toolUseBlock("quote_delivery", {})], "tool_use"));
    const result = await runAgentTurn({ call, system: SYSTEM, history: HISTORY, backend: fixtureBackend(), catalogPrices: [] });
    expect(result).toEqual({ kind: "handoff", reason: "tool_budget_exhausted", toolCalls: 8 });
    expect(call).toHaveBeenCalledTimes(9);
  });

  it("hands off when the model calls handoff_to_human", async () => {
    const call = vi.fn().mockResolvedValue(turn([toolUseBlock("handoff_to_human", { reason: "Refund request" })], "tool_use"));
    await expect(
      runAgentTurn({ call, system: SYSTEM, history: HISTORY, backend: fixtureBackend(), catalogPrices: [] }),
    ).resolves.toEqual({ kind: "handoff", reason: "Refund request", toolCalls: 1 });
  });

  it("reports a model failure", async () => {
    const call = vi.fn().mockResolvedValue({ ok: false, reason: "budget_exceeded" });
    await expect(
      runAgentTurn({ call, system: SYSTEM, history: HISTORY, backend: fixtureBackend(), catalogPrices: [] }),
    ).resolves.toEqual({ kind: "failed", reason: "budget_exceeded", toolCalls: 0 });
  });
});
