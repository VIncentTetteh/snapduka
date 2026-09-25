import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("@/lib/supabase/request", () => ({ createRequestScopedClient: vi.fn() }));

import type { BuyerActor } from "@/lib/auth/actor";

import type { BuyerClient } from "./account";
import { getBuyerSession } from "./session";

const client = {} as BuyerClient;
const buyer: BuyerActor = {
  kind: "buyer",
  authenticated: true,
  userId: "u1",
  buyerProfileId: "p1",
  phone: "+233241234567",
  consented: true,
};
const unprovisioned = { kind: "unprovisioned", authenticated: true, userId: "u1", email: null } as const;

function deps(overrides: Partial<Parameters<typeof getBuyerSession>[0]> = {}) {
  return {
    enabled: vi.fn().mockResolvedValue(true),
    resolve: vi.fn().mockResolvedValue(buyer),
    client: vi.fn().mockResolvedValue(client),
    bootstrap: vi.fn(),
    claim: vi.fn().mockResolvedValue({ status: "ok", claimed: 0 }),
    ...overrides,
  };
}

describe("getBuyerSession", () => {
  it("is disabled, touching nothing else, while the flag is off", async () => {
    const d = deps({ enabled: vi.fn().mockResolvedValue(false) });

    await expect(getBuyerSession(d)).resolves.toEqual({ state: "disabled" });
    expect(d.resolve).not.toHaveBeenCalled();
  });

  it("is anonymous with no session", async () => {
    const d = deps({ resolve: vi.fn().mockResolvedValue({ kind: "anonymous", authenticated: false }) });

    await expect(getBuyerSession(d)).resolves.toEqual({ state: "anonymous" });
    expect(d.bootstrap).not.toHaveBeenCalled();
  });

  it("bootstraps on first sign-in and returns the new buyer", async () => {
    const resolve = vi.fn().mockResolvedValueOnce(unprovisioned).mockResolvedValueOnce(buyer);
    const bootstrap = vi.fn().mockResolvedValue({ status: "ok", created: true, profileId: "p1", phone: buyer.phone, consented: false });
    const d = deps({ resolve, bootstrap });

    await expect(getBuyerSession(d)).resolves.toMatchObject({ state: "buyer", buyer: { buyerProfileId: "p1" } });
    expect(bootstrap).toHaveBeenCalledWith(client);
  });

  it("asks for a phone when the session is not a verified-phone login", async () => {
    const d = deps({
      resolve: vi.fn().mockResolvedValue(unprovisioned),
      bootstrap: vi.fn().mockResolvedValue({ status: "phone_unverified" }),
    });

    await expect(getBuyerSession(d)).resolves.toEqual({ state: "needs_phone" });
  });

  it("surfaces a phone held by another profile instead of guessing", async () => {
    const d = deps({
      resolve: vi.fn().mockResolvedValue(unprovisioned),
      bootstrap: vi.fn().mockResolvedValue({ status: "phone_in_use" }),
    });

    await expect(getBuyerSession(d)).resolves.toEqual({ state: "phone_in_use" });
  });

  it("claims guest orders for a consented buyer", async () => {
    const d = deps();

    await getBuyerSession(d);

    expect(d.claim).toHaveBeenCalledWith(client);
  });

  it("does not claim when the caller asks for a read-only resolve", async () => {
    const d = deps();

    await getBuyerSession({ ...d, claimOnResolve: false });

    expect(d.claim).not.toHaveBeenCalled();
  });

  it("never claims without consent", async () => {
    const d = deps({ resolve: vi.fn().mockResolvedValue({ ...buyer, consented: false }) });

    await getBuyerSession(d);

    expect(d.claim).not.toHaveBeenCalled();
  });
});
