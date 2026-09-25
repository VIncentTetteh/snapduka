// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ applyKycResult: vi.fn() }));
vi.mock("@/lib/kyc/service", () => ({ applyKycResult: mocks.applyKycResult }));

import { hmacSha256Hex } from "@/lib/couriers/adapters/shared";
import { createSandboxKycProvider, KYC_SANDBOX_SIGNATURE_HEADER } from "@/lib/kyc/providers/sandbox";
import { setKycProvidersForTests } from "@/lib/kyc/registry";

import { POST } from "./route";

const body = JSON.stringify({ results: [{ ref: "ref-1", status: "passed", matchScore: 97 }] });
const params = (provider: string) => ({ params: Promise.resolve({ provider }) });

function request(raw: string, signature?: string) {
  return new Request("http://localhost/api/kyc/webhook/sandbox", {
    method: "POST",
    headers: signature ? { [KYC_SANDBOX_SIGNATURE_HEADER]: signature } : {},
    body: raw,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setKycProvidersForTests([createSandboxKycProvider({ enabled: true, webhookSecret: "s3cret" })]);
  mocks.applyKycResult.mockResolvedValue({ applied: true });
});

describe("POST /api/kyc/webhook/[provider]", () => {
  it("applies a correctly signed result", async () => {
    const response = await POST(request(body, hmacSha256Hex("s3cret", body)), params("sandbox"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: 1, applied: 1 });
    expect(mocks.applyKycResult).toHaveBeenCalledWith("sandbox", expect.objectContaining({ providerRef: "ref-1", status: "passed" }));
  });

  it("refuses a forged result before parsing it", async () => {
    const response = await POST(request(body, hmacSha256Hex("wrong", body)), params("sandbox"));
    expect(response.status).toBe(401);
    expect(mocks.applyKycResult).not.toHaveBeenCalled();
  });

  it("404s an unknown provider", async () => {
    const response = await POST(request(body), params("nobody"));
    expect(response.status).toBe(404);
  });

  it("asks the vendor to retry when the result cannot be applied", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.applyKycResult.mockRejectedValue(new Error("db down"));
    const response = await POST(request(body, hmacSha256Hex("s3cret", body)), params("sandbox"));
    expect(response.status).toBe(500);
  });
});
