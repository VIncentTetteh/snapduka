import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeMessage, textBlock, textReply } from "../../ai/testing";

/**
 * The orchestration around the agent: who gets answered, by what, and when a
 * person is brought in. The database is faked per table so each test states
 * the conversation it is about.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  conversation: null as Record<string, unknown> | null,
  messages: [] as Record<string, unknown>[],
  updates: [] as { table: string; values: Record<string, unknown> }[],
  claim: true,
}));

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  classifyCall: vi.fn(),
  agentCall: vi.fn(),
  sendFreeFormMessage: vi.fn(),
  setHumanMode: vi.fn(),
  notifySellerDevices: vi.fn(),
  rpc: vi.fn(),
}));

class FakeQuery {
  constructor(
    private table: string,
    private result: () => { data: unknown; error: null },
  ) {}
  select() { return this; }
  eq() { return this; }
  neq() { return this; }
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  update(values: Row) {
    state.updates.push({ table: this.table, values });
    return this;
  }
  maybeSingle() { return Promise.resolve(this.result()); }
  then<T>(resolve: (value: { data: unknown; error: null }) => T) {
    return Promise.resolve(this.result()).then(resolve);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("../vault", () => ({ readWhatsAppVaultSecrets: async () => null, cachedWhatsAppVaultSecrets: () => null }));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("@/lib/ai/client", () => ({
  AI_MODELS: { fast: "claude-haiku-4-5-20251001", agent: "claude-sonnet-5" },
  cachedSystem: (text: string) => [{ type: "text", text }],
  modelCaller: (options: { purpose: string }) =>
    options.purpose === "wa.classify" ? mocks.classifyCall : mocks.agentCall,
}));
vi.mock("../outbound", () => ({ sendFreeFormMessage: mocks.sendFreeFormMessage }));
vi.mock("../handoff", () => ({ setHumanMode: mocks.setHumanMode, notifySellerDevices: mocks.notifySellerDevices }));
vi.mock("./backend", async () => {
  const fixtures = await import("./fixtures");
  return {
    createToolBackend: () => fixtures.fixtureBackend(),
    catalogSummary: async () => ({ text: "p1 | Sneakers | GH₵450.00", prices: ["GH₵450.00"] }),
  };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      new FakeQuery(table, () => {
        if (table === "wa_conversations") return { data: state.conversation, error: null };
        if (table === "wa_messages") return { data: [...state.messages].reverse(), error: null };
        if (table === "shops") {
          return {
            data: { id: "shop-1", slug: "kofi-shoes-k7m2", slug_code: "k7m2", display_name: "Kofi Shoes", currency: "GHS" },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    rpc: mocks.rpc,
  }),
}));

import { ConversationBusyError, processConversation, toModelHistory } from "./process";

const BUYER = "+233201234567";

function conversation(overrides: Row = {}) {
  return {
    id: "conv-1",
    buyer_phone: BUYER,
    seller_account_id: "seller-1",
    mode: "agent",
    human_until: null,
    language: null,
    disclosed_at: null,
    last_outbound_at: null,
    ...overrides,
  };
}

function inbound(body: string, overrides: Row = {}) {
  return {
    id: `m-${state.messages.length + 1}`,
    direction: "inbound",
    type: "text",
    body,
    media_id: null,
    media_mime: null,
    author: "buyer",
    created_at: new Date().toISOString(),
    agent_handled_at: null,
    ...overrides,
  };
}

const CLASSIFIED = (intent: string, extra: Row = {}) =>
  textReply(JSON.stringify({ language: "en", intent, needsHuman: false, confidence: 0.9, ...extra }));

function sentTexts(): string[] {
  return mocks.sendFreeFormMessage.mock.calls.map((call) => call[0].text);
}

function handledUpdate() {
  return state.updates.find((update) => update.table === "wa_messages" && "agent_handled_at" in update.values);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.conversation = conversation();
  state.messages = [];
  state.updates = [];
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.rpc.mockImplementation(async (fn: string) => ({ data: fn === "wa_claim_conversation" ? state.claim : null, error: null }));
  state.claim = true;
  mocks.sendFreeFormMessage.mockResolvedValue({ delivered: true, wamid: "wamid.out" });
  mocks.classifyCall.mockResolvedValue(CLASSIFIED("product_question"));
  mocks.agentCall.mockResolvedValue({ ok: true, message: fakeMessage([textBlock("Yes, we have them for GH₵450.00.")]) });
});

describe("processConversation", () => {
  it("answers, disclosing the assistant on the first reply, and marks the message handled", async () => {
    state.messages = [inbound("Do you have black sneakers?")];

    await expect(processConversation("conv-1")).resolves.toBe("replied");

    const [reply] = sentTexts();
    expect(reply).toMatch(/^Hi! I'm Kofi Shoes's automated assistant on SnapDuka\. Type HUMAN/);
    expect(reply).toContain("GH₵450.00");
    expect(mocks.sendFreeFormMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: BUYER, conversationId: "conv-1", author: "agent", sellerAccountId: "seller-1" }),
    );
    expect(state.updates.some((update) => "disclosed_at" in update.values)).toBe(true);
    expect(handledUpdate()).toBeDefined();
    expect(mocks.rpc).toHaveBeenCalledWith("wa_release_conversation", { p_conversation_id: "conv-1" });
  });

  it("does not disclose twice", async () => {
    state.conversation = conversation({ disclosed_at: "2026-09-01T00:00:00Z" });
    state.messages = [inbound("price?")];
    await processConversation("conv-1");
    expect(sentTexts()[0]).toBe("Yes, we have them for GH₵450.00.");
  });

  it("is a no-op when an earlier event already handled everything", async () => {
    state.messages = [inbound("hi", { agent_handled_at: "2026-09-25T00:00:00Z" })];
    await expect(processConversation("conv-1")).resolves.toBe("nothing_pending");
    expect(mocks.sendFreeFormMessage).not.toHaveBeenCalled();
  });

  it("throws while another worker holds the conversation, so the event retries", async () => {
    state.claim = false;
    state.messages = [inbound("hi")];
    await expect(processConversation("conv-1")).rejects.toBeInstanceOf(ConversationBusyError);
    expect(mocks.sendFreeFormMessage).not.toHaveBeenCalled();
  });

  it("asks an unbound buyer which shop they mean, without any model", async () => {
    state.conversation = conversation({ seller_account_id: null });
    state.messages = [inbound("hello")];
    await expect(processConversation("conv-1")).resolves.toBe("asked_for_shop");
    expect(sentTexts()[0]).toMatch(/Which shop/);
    expect(mocks.classifyCall).not.toHaveBeenCalled();
  });

  it("leaves the conversation to the seller while wa_agent is off", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    state.messages = [inbound("hi")];
    await expect(processConversation("conv-1")).resolves.toBe("agent_off");
    expect(mocks.sendFreeFormMessage).not.toHaveBeenCalled();
    expect(mocks.notifySellerDevices).toHaveBeenCalled();
    expect(handledUpdate()).toBeDefined();
  });

  it("stays quiet during a human takeover", async () => {
    state.conversation = conversation({ mode: "human", human_until: new Date(Date.now() + 3_600_000).toISOString() });
    state.messages = [inbound("hello?")];
    await expect(processConversation("conv-1")).resolves.toBe("human");
    expect(mocks.sendFreeFormMessage).not.toHaveBeenCalled();
  });

  it("returns to the agent once the takeover lapses", async () => {
    state.conversation = conversation({ mode: "human", human_until: new Date(Date.now() - 1000).toISOString() });
    state.messages = [inbound("still there?")];
    await expect(processConversation("conv-1")).resolves.toBe("replied");
    expect(state.updates).toContainEqual({ table: "wa_conversations", values: { mode: "agent", human_until: null } });
  });

  it("hands off on HUMAN without asking any model", async () => {
    state.messages = [inbound("HUMAN")];
    await expect(processConversation("conv-1")).resolves.toBe("handed_off");
    expect(mocks.classifyCall).not.toHaveBeenCalled();
    expect(mocks.setHumanMode).toHaveBeenCalledWith({ conversationId: "conv-1", sellerAccountId: "seller-1" });
    expect(sentTexts()[0]).toMatch(/asked the shop to reply/);
    expect(mocks.notifySellerDevices).toHaveBeenCalledWith(
      expect.objectContaining({ sellerAccountId: "seller-1", conversationId: "conv-1" }),
    );
  });

  it("hands off a complaint the classifier flags", async () => {
    mocks.classifyCall.mockResolvedValue(CLASSIFIED("complaint", { needsHuman: true }));
    state.messages = [inbound("the shoes came broken")];
    await expect(processConversation("conv-1")).resolves.toBe("handed_off");
    expect(mocks.agentCall).not.toHaveBeenCalled();
  });

  it("hands off on low confidence", async () => {
    mocks.classifyCall.mockResolvedValue(CLASSIFIED("other", { confidence: 0.3 }));
    state.messages = [inbound("hmm")];
    await expect(processConversation("conv-1")).resolves.toBe("handed_off");
  });

  it("declines off-topic messages without the agent", async () => {
    mocks.classifyCall.mockResolvedValue(CLASSIFIED("off_topic"));
    state.messages = [inbound("who will win the election?")];
    await expect(processConversation("conv-1")).resolves.toBe("off_topic");
    expect(mocks.agentCall).not.toHaveBeenCalled();
    expect(sentTexts()[0]).toMatch(/only help with this shop/);
  });

  it("asks a voice note to type while no transcriber is configured", async () => {
    state.messages = [inbound("", { type: "voice", media_id: "MEDIA" })];
    await expect(processConversation("conv-1")).resolves.toBe("voice_unsupported");
    expect(sentTexts()[0]).toMatch(/voice notes/);
  });

  it("hands off when the AI budget is spent, rather than going silent", async () => {
    mocks.agentCall.mockResolvedValue({ ok: false, reason: "budget_exceeded" });
    state.messages = [inbound("do you have sneakers")];
    await expect(processConversation("conv-1")).resolves.toBe("handed_off");
    expect(mocks.setHumanMode).toHaveBeenCalled();
  });

  it("answers a burst of messages once", async () => {
    state.messages = [inbound("hi"), inbound("do you have"), inbound("black sneakers size 42")];
    await processConversation("conv-1");
    expect(mocks.sendFreeFormMessage).toHaveBeenCalledTimes(1);
    expect(mocks.classifyCall.mock.calls[0][0].messages[0].content).toBe("hi\ndo you have\nblack sneakers size 42");
  });
});

describe("toModelHistory", () => {
  it("starts with the buyer, labels shop staff, and ends with the pending text", () => {
    const history = toModelHistory(
      [
        { ...inbound("x"), direction: "outbound", author: "system", body: "Your order is confirmed" },
        inbound("thanks, when will it come?"),
        { ...inbound("x"), direction: "outbound", author: "seller", body: "Tomorrow" },
        inbound("ok"),
      ],
      "ok",
    );
    expect(history.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(history[1].content).toBe("[shop staff] Tomorrow");
  });
});
