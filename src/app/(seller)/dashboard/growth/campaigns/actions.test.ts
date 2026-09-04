import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  getSellerPlan: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/billing/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/resolve")>();
  return { ...actual, getSellerPlan: mocks.getSellerPlan };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { createCampaign } from "./actions";

/**
 * createCampaign had no test at all, and every one of its failure branches was
 * a bare `return` — so a seller who could not create a link saw the form reload
 * unchanged. Production bears this out: of 17 campaign links, none has
 * `destination_path = '/'`, meaning nothing this action produced ever survived
 * its own token-shape bug.
 */

const SELLER = {
  kind: "seller" as const,
  authenticated: true,
  userId: "user-1",
  email: "seller@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

const PLAN = { planCode: "free", planName: "Free", entitlements: { campaigns: true } };

/** The DB constraint the old token builder kept violating. */
const TOKEN_SHAPE = /^[a-z0-9][a-z0-9-]{3,63}$/;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Runs the action and returns the redirect URL it bailed to, if any. */
async function runExpectingRedirect(data: FormData): Promise<string | null> {
  try {
    await createCampaign(data);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return message.startsWith("REDIRECT:") ? message.slice("REDIRECT:".length) : null;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER);
  mocks.getSellerPlan.mockResolvedValue(PLAN);
  mocks.insert.mockReturnValue({
    select: () => ({ single: async () => ({ data: { id: "link-1" }, error: null }) }),
  });
  mocks.createClient.mockResolvedValue({
    from: (table: string) =>
      table === "shops"
        ? {
            select: () => ({
              eq: () => ({ single: async () => ({ data: { id: "shop-1", slug: "sika-threads" } }) }),
            }),
          }
        : { insert: mocks.insert },
  });
});

describe("createCampaign", () => {
  it("points the link at the seller's shop, not the app root", async () => {
    await createCampaign(form({ name: "June launch", channel: "tiktok" }));

    // Never set before, so it fell back to the column default '/', which via
    // /l/{token} redirects to the app root rather than the shop.
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ destination_path: "/sika-threads", channel: "tiktok" }),
    );
  });

  it("mints a token the shape constraint accepts", async () => {
    await createCampaign(form({ name: "June launch", channel: "tiktok" }));

    const { token } = mocks.insert.mock.calls[0]![0] as { token: string };
    expect(token).toMatch(TOKEN_SHAPE);
    expect(token).toContain("june-launch");
  });

  it("survives a name with no usable characters", async () => {
    // Normalizes to "", which used to produce a token starting with "-".
    await createCampaign(form({ name: "🎉🎉", channel: "tiktok" }));

    const { token } = mocks.insert.mock.calls[0]![0] as { token: string };
    expect(token).toMatch(TOKEN_SHAPE);
    expect(token.startsWith("-")).toBe(false);
  });

  it("survives a name far longer than the 64-character limit", async () => {
    await createCampaign(form({ name: "a".repeat(300), channel: "whatsapp" }));

    const { token } = mocks.insert.mock.calls[0]![0] as { token: string };
    expect(token).toMatch(TOKEN_SHAPE);
    expect(token.length).toBeLessThanOrEqual(64);
  });

  it("says why rather than reloading the form unchanged", async () => {
    const cases: [Record<string, string>, string][] = [
      [{ name: "", channel: "tiktok" }, "name"],
      [{ name: "Valid", channel: "carrier-pigeon" }, "channel"],
    ];

    for (const [fields, expected] of cases) {
      const url = await runExpectingRedirect(form(fields));
      expect(url, JSON.stringify(fields)).toContain("error=");
      expect(decodeURIComponent(url ?? "").toLowerCase()).toContain(expected);
    }
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("refuses a role that cannot manage campaigns, out loud", async () => {
    mocks.resolveServerActor.mockResolvedValue({ ...SELLER, role: "fulfillment" as const });

    const url = await runExpectingRedirect(form({ name: "June", channel: "tiktok" }));

    expect(url).toContain("error=");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("refuses when the seller has no shop yet", async () => {
    mocks.createClient.mockResolvedValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
    });

    const url = await runExpectingRedirect(form({ name: "June", channel: "tiktok" }));

    expect(decodeURIComponent(url ?? "")).toContain("shop");
  });

  it("retries a token collision instead of failing", async () => {
    mocks.insert
      .mockReturnValueOnce({
        select: () => ({ single: async () => ({ data: null, error: { code: "23505" } }) }),
      })
      .mockReturnValueOnce({
        select: () => ({ single: async () => ({ data: { id: "link-1" }, error: null }) }),
      });

    await createCampaign(form({ name: "June launch", channel: "tiktok" }));

    expect(mocks.insert).toHaveBeenCalledTimes(2);
    const first = (mocks.insert.mock.calls[0]![0] as { token: string }).token;
    const second = (mocks.insert.mock.calls[1]![0] as { token: string }).token;
    expect(first).not.toBe(second);
  });
});
