import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  conversation: null as Record<string, unknown> | null,
  rows: [] as Record<string, unknown>[],
  calls: [] as { table: string; method: string; args: unknown[] }[],
  member: null as { id: string } | null,
}));

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  sendFreeFormMessage: vi.fn(),
  setHumanMode: vi.fn(),
}));

class FakeQuery {
  constructor(private table: string) {}
  private record(method: string, args: unknown[]) {
    state.calls.push({ table: this.table, method, args });
    return this;
  }
  select(...args: unknown[]) { return this.record("select", args); }
  eq(...args: unknown[]) { return this.record("eq", args); }
  or(...args: unknown[]) { return this.record("or", args); }
  order(...args: unknown[]) { return this.record("order", args); }
  limit(...args: unknown[]) { return this.record("limit", args); }
  update(...args: unknown[]) { return this.record("update", args); }
  maybeSingle() {
    if (this.table === "team_memberships") return Promise.resolve({ data: state.member, error: null });
    return Promise.resolve({ data: state.conversation, error: null });
  }
  then<T>(resolve: (value: { data: unknown; error: null }) => T) {
    return Promise.resolve({ data: state.rows, error: null }).then(resolve);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("./outbound", async (importOriginal) => ({
  isWithinServiceWindow: (await importOriginal<typeof import("./outbound")>()).isWithinServiceWindow,
  sendFreeFormMessage: mocks.sendFreeFormMessage,
}));
vi.mock("./handoff", () => ({ HUMAN_TAKEOVER_MS: 12 * 3_600_000, setHumanMode: mocks.setHumanMode }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => new FakeQuery(table) }) }));

import {
  decodeCursor,
  encodeCursor,
  getThread,
  listConversations,
  replyAsSeller,
  setConversationMode,
} from "./inbox";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    buyer_phone: "+233201234567",
    mode: "agent",
    human_until: null,
    assigned_member_id: null,
    language: "pcm",
    last_message_at: "2026-09-25T10:00:00.000Z",
    last_inbound_at: new Date(Date.now() - 3_600_000).toISOString(),
    last_message_preview: "how much?",
    unread_count: 2,
    ...overrides,
  };
}

function filtersOn(table: string, method: string) {
  return state.calls.filter((call) => call.table === table && call.method === method).map((call) => call.args);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.conversation = row();
  state.rows = [];
  state.calls = [];
  state.member = null;
  mocks.isFeatureEnabled.mockResolvedValue(true);
  mocks.sendFreeFormMessage.mockResolvedValue({ delivered: true, wamid: "wamid.R" });
});

describe("cursors", () => {
  it("round-trip", () => {
    const cursor = { at: "2026-09-25T10:00:00.000Z", id: CONVERSATION_ID };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  // The cursor is interpolated into a PostgREST filter; anything that is not a
  // timestamp and a uuid is dropped rather than trusted.
  it("rejects a tampered cursor", () => {
    const evil = Buffer.from(JSON.stringify({ at: "2026-01-01", id: "x),seller_account_id.neq.(y" })).toString("base64url");
    expect(decodeCursor(evil)).toBeNull();
    expect(decodeCursor("not-base64")).toBeNull();
  });
});

describe("listConversations", () => {
  it("scopes to the seller, pages by keyset and reports the 24h window", async () => {
    state.rows = [row(), row({ id: "22222222-2222-4222-8222-222222222222", last_inbound_at: null })];

    const page = await listConversations("seller-1", { limit: 1 });

    expect(filtersOn("wa_conversations", "eq")).toContainEqual(["seller_account_id", "seller-1"]);
    expect(page.conversations).toHaveLength(1);
    expect(page.conversations[0]).toMatchObject({ buyerPhone: "+233201234567", windowOpen: true, language: "pcm" });
    expect(decodeCursor(page.nextCursor)).toEqual({ at: "2026-09-25T10:00:00.000Z", id: CONVERSATION_ID });
  });

  it("applies the cursor as a strict keyset condition", async () => {
    await listConversations("seller-1", { cursor: encodeCursor({ at: "2026-09-25T10:00:00.000Z", id: CONVERSATION_ID }) });
    expect(filtersOn("wa_conversations", "or")[0][0]).toBe(
      `last_message_at.lt."2026-09-25T10:00:00.000Z",and(last_message_at.eq."2026-09-25T10:00:00.000Z",id.lt.${CONVERSATION_ID})`,
    );
  });
});

describe("getThread", () => {
  it("is null for another seller's conversation", async () => {
    state.conversation = null;
    await expect(getThread("seller-1", CONVERSATION_ID)).resolves.toBeNull();
  });

  it("returns messages oldest first and marks the thread read", async () => {
    state.rows = [
      { id: "m2", direction: "outbound", author: "agent", type: "text", body: "b", template_name: null, status: "read", created_at: "2" },
      { id: "m1", direction: "inbound", author: "buyer", type: "text", body: "a", template_name: null, status: "received", created_at: "1" },
    ];
    const thread = await getThread("seller-1", CONVERSATION_ID);
    expect(thread?.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(filtersOn("wa_conversations", "update")).toContainEqual([{ unread_count: 0 }]);
  });
});

describe("replyAsSeller", () => {
  const input = { sellerAccountId: "seller-1", userId: "user-1", conversationId: CONVERSATION_ID, text: "Yes, size 42 is in" };

  it("sends inside the window and takes the conversation over", async () => {
    state.member = { id: "member-1" };
    await expect(replyAsSeller(input)).resolves.toEqual({ ok: true, wamid: "wamid.R" });
    expect(mocks.sendFreeFormMessage).toHaveBeenCalledWith(
      expect.objectContaining({ author: "seller", authorUserId: "user-1", conversationId: CONVERSATION_ID }),
    );
    expect(mocks.setHumanMode).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      sellerAccountId: "seller-1",
      assignedMemberId: "member-1",
    });
  });

  it("refuses outside the window without calling WhatsApp", async () => {
    state.conversation = row({ last_inbound_at: "2026-01-01T00:00:00Z" });
    await expect(replyAsSeller(input)).resolves.toEqual({ ok: false, reason: "window_closed" });
    expect(mocks.sendFreeFormMessage).not.toHaveBeenCalled();
  });

  it("is off while wa_outbound is off", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    await expect(replyAsSeller(input)).resolves.toEqual({ ok: false, reason: "not_enabled" });
  });

  it("does not take over when the send failed", async () => {
    mocks.sendFreeFormMessage.mockResolvedValue({ delivered: false, reason: "rejected" });
    await expect(replyAsSeller(input)).resolves.toEqual({ ok: false, reason: "failed" });
    expect(mocks.setHumanMode).not.toHaveBeenCalled();
  });

  it("is not_found for another seller's conversation", async () => {
    state.conversation = null;
    await expect(replyAsSeller(input)).resolves.toEqual({ ok: false, reason: "not_found" });
  });
});

describe("setConversationMode", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  it("takes over for 12 hours, assigned to the caller", async () => {
    state.member = { id: "member-1" };
    await setConversationMode({ sellerAccountId: "seller-1", userId: "u", conversationId: CONVERSATION_ID, mode: "human", now });
    expect(filtersOn("wa_conversations", "update")[0][0]).toEqual({
      mode: "human",
      human_until: "2026-09-26T00:00:00.000Z",
      assigned_member_id: "member-1",
    });
  });

  it("hands back, clearing the takeover", async () => {
    await setConversationMode({ sellerAccountId: "seller-1", userId: "u", conversationId: CONVERSATION_ID, mode: "agent", now });
    expect(filtersOn("wa_conversations", "update")[0][0]).toEqual({ mode: "agent", human_until: null, assigned_member_id: null });
  });
});
