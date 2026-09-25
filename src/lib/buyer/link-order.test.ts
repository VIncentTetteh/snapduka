import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/flags", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/request", () => ({ createRequestScopedClient: vi.fn() }));

import type { BuyerActor } from "@/lib/auth/actor";

import { linkCheckoutOrderToBuyer } from "./link-order";

const buyer: BuyerActor = {
  kind: "buyer",
  authenticated: true,
  userId: "u1",
  buyerProfileId: "profile-1",
  phone: "+233241234567",
  consented: true,
};

function deps(overrides: Partial<Parameters<typeof linkCheckoutOrderToBuyer>[2]> = {}) {
  return {
    enabled: vi.fn().mockResolvedValue(true),
    resolve: vi.fn().mockResolvedValue(buyer),
    link: vi.fn().mockResolvedValue({ status: "linked" }),
    ...overrides,
  };
}

describe("linkCheckoutOrderToBuyer", () => {
  it("links with the profile from the session, scoped by the order's seller for the flag", async () => {
    const d = deps();

    await expect(linkCheckoutOrderToBuyer("order-1", "seller-1", d)).resolves.toBe("linked");
    expect(d.enabled).toHaveBeenCalledWith("seller-1");
    expect(d.link).toHaveBeenCalledWith("order-1", "profile-1");
  });

  it("does nothing while the flag is off — guest checkout exactly as before", async () => {
    const d = deps({ enabled: vi.fn().mockResolvedValue(false) });

    await expect(linkCheckoutOrderToBuyer("order-1", "seller-1", d)).resolves.toBe("skipped_disabled");
    expect(d.resolve).not.toHaveBeenCalled();
    expect(d.link).not.toHaveBeenCalled();
  });

  it("does nothing for a guest", async () => {
    const d = deps({ resolve: vi.fn().mockResolvedValue({ kind: "anonymous", authenticated: false }) });

    await expect(linkCheckoutOrderToBuyer("order-1", "seller-1", d)).resolves.toBe("skipped_no_buyer");
    expect(d.link).not.toHaveBeenCalled();
  });

  it("does nothing without shared-profile consent", async () => {
    const d = deps({ resolve: vi.fn().mockResolvedValue({ ...buyer, consented: false }) });

    await expect(linkCheckoutOrderToBuyer("order-1", "seller-1", d)).resolves.toBe("skipped_no_consent");
    expect(d.link).not.toHaveBeenCalled();
  });

  it("reports a database refusal (e.g. phone mismatch) without throwing", async () => {
    const d = deps({ link: vi.fn().mockResolvedValue({ status: "phone_mismatch" }) });

    await expect(linkCheckoutOrderToBuyer("order-1", "seller-1", d)).resolves.toBe("refused");
  });

  it("never throws into the checkout route", async () => {
    const d = deps({ link: vi.fn().mockRejectedValue(new Error("db down")) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(linkCheckoutOrderToBuyer("order-1", "seller-1", d)).resolves.toBe("failed");
    log.mockRestore();
  });

  it("swallows a failing flag lookup too", async () => {
    const d = deps({ enabled: vi.fn().mockRejectedValue(new Error("flags down")) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(linkCheckoutOrderToBuyer("order-1", "seller-1", d)).resolves.toBe("failed");
    log.mockRestore();
  });
});
