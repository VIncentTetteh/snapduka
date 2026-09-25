import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  insert: vi.fn(),
  rpc: vi.fn(),
  getSellerPlan: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic {
    static APIError = actual.default.APIError;
    messages = { create: mocks.create };
  }
  return { default: FakeAnthropic };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ insert: mocks.insert }),
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/billing/resolve", () => ({ getSellerPlan: mocks.getSellerPlan }));

import { monthlyBudgetMicros } from "./budget";
import { cachedSystem, callModel, isAiConfigured, resetAiClientForTests } from "./client";
import { fakeMessage, textBlock } from "./testing";

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
const OPTIONS = { sellerAccountId: "seller-1", purpose: "listing_draft", model: "claude-sonnet-5" as const };
const REQUEST = { max_tokens: 50, messages: [{ role: "user" as const, content: "hi" }] };

beforeEach(() => {
  vi.clearAllMocks();
  resetAiClientForTests();
  process.env.ANTHROPIC_API_KEY = "sk-test";
  mocks.insert.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ data: 0, error: null });
  mocks.getSellerPlan.mockResolvedValue({ planCode: "free", entitlements: {} });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  resetAiClientForTests();
});

describe("callModel", () => {
  it("reports not_configured without a key, and records nothing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    resetAiClientForTests();

    expect(isAiConfigured()).toBe(false);
    await expect(callModel(OPTIONS, REQUEST)).resolves.toEqual({ ok: false, reason: "not_configured" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("binds the model and records tokens, cache hits and cost", async () => {
    mocks.create.mockResolvedValue(
      fakeMessage([textBlock("ok")], "end_turn", {
        input_tokens: 1000,
        output_tokens: 100,
        cache_read_input_tokens: 10000,
        cache_creation_input_tokens: 0,
      }),
    );

    const result = await callModel({ ...OPTIONS, context: { productId: "p1" } }, REQUEST);

    expect(result.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-5", stream: false, max_tokens: 50 }),
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        seller_account_id: "seller-1",
        purpose: "listing_draft",
        model: "claude-sonnet-5",
        input_tokens: 1000,
        output_tokens: 100,
        cache_read_tokens: 10000,
        cost_usd_micros: 2000 + 1000 + 2000,
        outcome: "ok",
        context: { productId: "p1" },
      }),
    );
  });

  it("refuses and records a budget_exceeded run once the month is spent", async () => {
    mocks.rpc.mockResolvedValue({ data: 1_000_000, error: null });

    await expect(callModel(OPTIONS, REQUEST)).resolves.toEqual({ ok: false, reason: "budget_exceeded" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "budget_exceeded", cost_usd_micros: 0 }),
    );
  });

  // An unbounded bill is worse than a declined draft.
  it("fails closed when spend cannot be read", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(callModel(OPTIONS, REQUEST)).resolves.toMatchObject({ ok: false, reason: "budget_exceeded" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("skips the budget for calls on nobody's behalf", async () => {
    mocks.create.mockResolvedValue(fakeMessage([textBlock("ok")]));
    await callModel({ ...OPTIONS, sellerAccountId: null }, REQUEST);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records an API failure as an error run and does not throw", async () => {
    mocks.create.mockRejectedValue(new Error("socket hang up"));
    await expect(callModel(OPTIONS, REQUEST)).resolves.toMatchObject({ ok: false, reason: "error" });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }));
  });

  it.each([
    ["refusal", "refused"],
    ["max_tokens", "max_tokens"],
  ] as const)("treats stop_reason %s as unusable", async (stopReason, outcome) => {
    mocks.create.mockResolvedValue(fakeMessage([textBlock("partial")], stopReason));
    await expect(callModel(OPTIONS, REQUEST)).resolves.toEqual({ ok: false, reason: outcome });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ outcome }));
  });

  it("still returns the answer when the ai_runs write fails", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "down" } });
    mocks.create.mockResolvedValue(fakeMessage([textBlock("ok")]));
    await expect(callModel(OPTIONS, REQUEST)).resolves.toMatchObject({ ok: true });
  });
});

describe("cachedSystem", () => {
  it("marks the block cacheable", () => {
    expect(cachedSystem("stable")).toEqual([
      { type: "text", text: "stable", cache_control: { type: "ephemeral" } },
    ]);
  });
});

describe("monthlyBudgetMicros", () => {
  it("uses the per-plan constant", () => {
    expect(monthlyBudgetMicros({ planCode: "growth", entitlements: {} })).toBe(10_000_000);
  });

  it("lets a plan version that carries the entitlement override it", () => {
    expect(
      monthlyBudgetMicros({ planCode: "growth", entitlements: { aiMonthlyBudgetUsdMicros: 42 } }),
    ).toBe(42);
  });

  it("gives an unknown plan the Free ceiling, never unlimited", () => {
    expect(monthlyBudgetMicros({ planCode: "enterprise_x", entitlements: {} })).toBe(1_000_000);
  });
});
