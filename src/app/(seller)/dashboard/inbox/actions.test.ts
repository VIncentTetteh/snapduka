import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  replyAsSeller: vi.fn(),
  setConversationMode: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/whatsapp/inbox", () => ({
  MAX_REPLY_LENGTH: 4096,
  replyAsSeller: mocks.replyAsSeller,
  setConversationMode: mocks.setConversationMode,
}));

import { replyAction, setModeAction } from "./actions";

const SELLER = { kind: "seller", sellerAccountId: "seller-1", userId: "u1", status: "active", role: undefined };

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.replyAsSeller.mockResolvedValue({ ok: true, wamid: "w" });
  mocks.setConversationMode.mockResolvedValue({ id: "c1" });
});

describe("replyAction", () => {
  it("sends and returns to the thread", async () => {
    await expect(replyAction(form({ conversationId: "c1", text: "hello" }))).rejects.toThrow("REDIRECT /dashboard/inbox?c=c1");
    expect(mocks.replyAsSeller).toHaveBeenCalledWith({ sellerAccountId: "seller-1", userId: "u1", conversationId: "c1", text: "hello" });
  });

  it("says why when the window has closed", async () => {
    mocks.replyAsSeller.mockResolvedValue({ ok: false, reason: "window_closed" });
    await expect(replyAction(form({ conversationId: "c1", text: "hello" }))).rejects.toThrow(/error=.*24\+hours/);
  });

  // kind "seller" is not an authorization check: an analyst resolves as one.
  it("refuses a role without orders.manage", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, role: "analyst" });
    await expect(replyAction(form({ conversationId: "c1", text: "hello" }))).rejects.toThrow(/error=/);
    expect(mocks.replyAsSeller).not.toHaveBeenCalled();
  });
});

describe("setModeAction", () => {
  it("takes over", async () => {
    await expect(setModeAction(form({ conversationId: "c1", mode: "human" }))).rejects.toThrow(/saved=/);
    expect(mocks.setConversationMode).toHaveBeenCalledWith({
      sellerAccountId: "seller-1",
      userId: "u1",
      conversationId: "c1",
      mode: "human",
    });
  });

  it("rejects an unknown mode", async () => {
    await expect(setModeAction(form({ conversationId: "c1", mode: "delete" }))).rejects.toThrow(/Unknown/);
    expect(mocks.setConversationMode).not.toHaveBeenCalled();
  });
});
