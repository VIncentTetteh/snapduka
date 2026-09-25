// @vitest-environment node
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hmacSha256Hex } from "@/lib/couriers/adapters/shared";

import { isKycCheckType, maskIdNumber, sanitizeKycDetails } from "./provider";
import { notConfiguredKycProvider } from "./providers/not-configured";
import { createSandboxKycProvider, KYC_SANDBOX_SIGNATURE_HEADER } from "./providers/sandbox";

describe("maskIdNumber", () => {
  it("keeps the country prefix and the last three characters", () => {
    expect(maskIdNumber("GHA-123456789-0")).toBe("GHA-*******89-0");
  });

  it("always masks something, even for short input", () => {
    expect(maskIdNumber("123")).toContain("*");
  });

  it("never returns the clear number", () => {
    expect(maskIdNumber("GHA-123456789-0")).not.toContain("1234567");
  });
});

describe("sanitizeKycDetails", () => {
  it("drops personal data and nested values, keeps flat vendor metadata", () => {
    expect(
      sanitizeKycDetails({
        jobId: "job-1",
        resultCode: 1012,
        smileVerified: true,
        idNumber: "GHA-123456789-0",
        full_name: "Ama Mensah",
        selfie: "base64...",
        nested: { a: 1 },
        "bad key": "x",
      }),
    ).toEqual({ jobId: "job-1", resultCode: 1012, smileVerified: true });
  });
});

describe("isKycCheckType", () => {
  it("accepts only the known types", () => {
    expect(isKycCheckType("ghana_card")).toBe(true);
    expect(isKycCheckType("passport")).toBe(false);
  });
});

describe("not-configured provider", () => {
  it("refuses to start anything", async () => {
    expect(notConfiguredKycProvider.status()).toBe("not_configured");
    await expect(
      notConfiguredKycProvider.startCheck({ sellerAccountId: "s", country: "GH", returnUrl: "https://x.test" }, "ghana_card"),
    ).rejects.toMatchObject({ code: "not_configured" });
    expect(await notConfiguredKycProvider.verifyWebhook({ rawBody: "{}", headers: {} })).toBe(false);
  });
});

describe("sandbox KYC provider", () => {
  const sandbox = createSandboxKycProvider({ enabled: true, webhookSecret: "kyc-secret", autoResult: "passed" });

  it("returns the seller to the return URL with the reference", async () => {
    const started = await sandbox.startCheck(
      { sellerAccountId: "s", country: "GH", returnUrl: "https://app.test/dashboard/settings/verification" },
      "ghana_card",
    );
    expect(started.providerRef).toMatch(/^sbxkyc_/);
    expect(started.redirectUrl).toBe(
      `https://app.test/dashboard/settings/verification?kyc_ref=${started.providerRef}`,
    );
    expect(started.sdkToken).toBe(`sandbox:${started.providerRef}`);
  });

  it("answers polling with the configured outcome, masked", async () => {
    const result = await sandbox.getResult("ref-1");
    expect(result).toMatchObject({ providerRef: "ref-1", status: "passed", matchScore: 95 });
    expect(result.maskedId).toContain("*");
  });

  it("stays pending when no auto result is configured", async () => {
    const quiet = createSandboxKycProvider({ enabled: true });
    expect((await quiet.getResult("ref-1")).status).toBe("pending");
  });

  it("verifies signatures and masks any ID number it is sent", async () => {
    const rawBody = JSON.stringify({
      results: [
        { ref: "ref-1", status: "passed", matchScore: 140, idNumber: "GHA-123456789-0", jobId: "j1" },
        { ref: "ref-2", status: "made_up" },
      ],
    });
    const headers = { [KYC_SANDBOX_SIGNATURE_HEADER]: hmacSha256Hex("kyc-secret", rawBody) };
    expect(await sandbox.verifyWebhook({ rawBody, headers })).toBe(true);
    expect(await sandbox.verifyWebhook({ rawBody: `${rawBody} `, headers })).toBe(false);

    const [result, ...rest] = sandbox.parseWebhook({ rawBody, headers });
    expect(rest).toEqual([]);
    expect(result).toMatchObject({ providerRef: "ref-1", status: "passed", matchScore: 100, maskedId: "GHA-*******89-0" });
    expect(JSON.stringify(result)).not.toContain("123456789");
  });

  it("is inert when disabled", async () => {
    const off = createSandboxKycProvider({ enabled: false, webhookSecret: "kyc-secret" });
    expect(off.status()).toBe("not_configured");
    const rawBody = "{}";
    expect(
      await off.verifyWebhook({ rawBody, headers: { [KYC_SANDBOX_SIGNATURE_HEADER]: hmacSha256Hex("kyc-secret", rawBody) } }),
    ).toBe(false);
  });
});
