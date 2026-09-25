import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { openBuyerToken } from "./crypto";
import { maskMsisdn, saveBuyerPaymentMethod } from "./payment-methods";

function adminStub() {
  const insert = vi.fn().mockReturnValue({
    select: () => ({ single: () => Promise.resolve({ data: { id: "pm-1" }, error: null }) }),
  });
  const admin = { from: vi.fn().mockReturnValue({ insert }) };
  return { admin: admin as unknown as Parameters<typeof saveBuyerPaymentMethod>[0], insert };
}

afterEach(() => vi.unstubAllEnvs());

describe("maskMsisdn", () => {
  it("shows a Ghana wallet in national format with the middle hidden", () => {
    expect(maskMsisdn("+233241234567")).toBe("024****567");
  });

  it("matches the database's allowed shape", () => {
    expect(maskMsisdn("+2348012345678")).toMatch(/^[0-9+*]{6,16}$/);
  });
});

describe("saveBuyerPaymentMethod", () => {
  it("does nothing when sealing is not configured", async () => {
    vi.stubEnv("BUYER_PAYMENT_TOKEN_KEY", "");
    const { admin, insert } = adminStub();

    await expect(
      saveBuyerPaymentMethod(admin, {
        buyerProfileId: "p1",
        method: "momo",
        network: "mtn",
        msisdn: "+233241234567",
        authorizationCode: "AUTH_x",
      }),
    ).resolves.toEqual({ ok: false, reason: "not_configured" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("stores only the masked number and a sealed token", async () => {
    vi.stubEnv("BUYER_PAYMENT_TOKEN_KEY", "k");
    const { admin, insert } = adminStub();

    await expect(
      saveBuyerPaymentMethod(admin, {
        buyerProfileId: "p1",
        method: "momo",
        network: "mtn",
        msisdn: "+233241234567",
        authorizationCode: "AUTH_x",
      }),
    ).resolves.toEqual({ ok: true, id: "pm-1" });

    const row = insert.mock.calls[0][0] as Record<string, string>;
    expect(JSON.stringify(row)).not.toContain("241234567");
    expect(JSON.stringify(row)).not.toContain("AUTH_x");
    expect(row.msisdn_masked).toBe("024****567");
    expect(openBuyerToken(row.provider_token_sealed)).toBe("AUTH_x");
  });
});
