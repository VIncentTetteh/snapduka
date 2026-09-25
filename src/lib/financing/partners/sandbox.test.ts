import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FINANCING_SANDBOX_SIGNATURE_HEADER, createSandboxFinancingPartner } from "./sandbox";

const SECRET = "whsec_test";
const ADVANCE = "11111111-1111-4111-8111-111111111111";
const REQUEST = {
  advanceId: ADVANCE,
  sellerAccountId: "22222222-2222-4222-8222-222222222222",
  country: "GH" as const,
  currency: "GHS" as const,
  principalMinor: 30_000,
  feeMinor: 1_800,
  totalRepayableMinor: 31_800,
};

function signed(body: unknown) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    headers: { [FINANCING_SANDBOX_SIGNATURE_HEADER]: createHmac("sha256", SECRET).update(rawBody).digest("hex") },
  };
}

describe("sandbox financing partner", () => {
  it("is not_configured and refuses everything unless explicitly enabled", async () => {
    const partner = createSandboxFinancingPartner({ enabled: false, webhookSecret: SECRET });
    expect(partner.status()).toBe("not_configured");
    await expect(partner.requestDisbursement(REQUEST)).rejects.toThrow(/off/);
    expect(await partner.verifyWebhook(signed({ events: [] }))).toBe(false);
  });

  it("funds by default, and can be told to decline or answer later", async () => {
    const funded = await createSandboxFinancingPartner({ enabled: true }).requestDisbursement(REQUEST);
    expect(funded.status).toBe("funded");
    expect(
      (await createSandboxFinancingPartner({ enabled: true, autoDecision: "declined" }).requestDisbursement(REQUEST)).status,
    ).toBe("declined");
    expect(
      (await createSandboxFinancingPartner({ enabled: true, autoDecision: "pending" }).requestDisbursement(REQUEST)).status,
    ).toBe("pending");
  });

  it("verifies the HMAC over the raw body and rejects anything else", async () => {
    const partner = createSandboxFinancingPartner({ enabled: true, webhookSecret: SECRET });
    const request = signed({ events: [] });
    expect(await partner.verifyWebhook(request)).toBe(true);
    expect(await partner.verifyWebhook({ ...request, rawBody: `${request.rawBody} ` })).toBe(false);
    expect(await partner.verifyWebhook({ rawBody: request.rawBody, headers: {} })).toBe(false);
  });

  it("parses well-formed events and drops malformed ones", () => {
    const partner = createSandboxFinancingPartner({ enabled: true, webhookSecret: SECRET });
    const events = partner.parseWebhook(
      signed({
        events: [
          { type: "advance.funded", advanceId: ADVANCE, partnerReference: "P-1" },
          { type: "advance.funded", advanceId: "not-a-uuid", partnerReference: "P-2" },
          { type: "advance.defaulted", advanceId: ADVANCE, reason: "stopped trading" },
          { type: "funding.settled", currency: "GHS", amountMinor: 30_000, reference: "BANK-1" },
          { type: "funding.settled", currency: "USD", amountMinor: 30_000, reference: "BANK-2" },
          { type: "funding.settled", currency: "GHS", amountMinor: -5, reference: "BANK-3" },
          { type: "something.else" },
        ],
      }),
    );
    expect(events).toEqual([
      { type: "advance.funded", advanceId: ADVANCE, partnerReference: "P-1" },
      { type: "advance.defaulted", advanceId: ADVANCE, reason: "stopped trading" },
      { type: "funding.settled", currency: "GHS", amountMinor: 30_000, reference: "BANK-1" },
    ]);
    expect(partner.parseWebhook({ rawBody: "not json", headers: {} })).toEqual([]);
  });
});
