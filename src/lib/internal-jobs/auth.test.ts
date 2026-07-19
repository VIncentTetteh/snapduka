import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only before importing auth
vi.mock("server-only");

import { isInternalJobRequest } from "./auth";

const originalEnv = { ...process.env };

function request(authHeader: string | null) {
  const headers = new Headers();
  if (authHeader !== null) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/internal/x", { headers });
}

describe("isInternalJobRequest", () => {
  beforeEach(() => {
    process.env.INTERNAL_JOB_SECRET = "correct-secret-value";
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("accepts the correct bearer secret", () => {
    expect(isInternalJobRequest(request("Bearer correct-secret-value"))).toBe(true);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(isInternalJobRequest(request("Bearer wrong-secret-value"))).toBe(false);
  });

  it("rejects a wrong secret of a different length without throwing", () => {
    expect(isInternalJobRequest(request("Bearer short"))).toBe(false);
  });

  it("rejects a missing authorization header", () => {
    expect(isInternalJobRequest(request(null))).toBe(false);
  });

  it("rejects when no secret is configured at all", () => {
    delete process.env.INTERNAL_JOB_SECRET;
    expect(isInternalJobRequest(request("Bearer anything"))).toBe(false);
  });
});
