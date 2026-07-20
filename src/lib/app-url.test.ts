import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));

import { appHost, appOrigin } from "./app-url";

function mockRequestHost(host: string, proto?: string) {
  mocks.headers.mockResolvedValue(
    new Headers({
      host,
      ...(proto ? { "x-forwarded-proto": proto } : {}),
    }),
  );
}

describe("appOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.headers.mockReset();
  });

  it("follows the live request host outside production, even when configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    mockRequestHost("localhost:3001");

    expect(await appOrigin()).toBe("http://localhost:3001");
    expect(await appHost()).toBe("localhost:3001");
  });

  it("prefers the configured canonical URL in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://snapduka.shop");
    mockRequestHost("internal-lb:8080");

    expect(await appOrigin()).toBe("https://snapduka.shop");
  });

  it("never trusts request headers in production, even when unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    mockRequestHost("evil.example.com", "https");

    // Host-header poisoning must not shape generated links (e.g. auth emails).
    expect(await appOrigin()).toBe("http://localhost:3000");
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("regression: falls back to the Vercel production domain, not localhost, when NEXT_PUBLIC_APP_URL is blank in production", async () => {
    // This is the exact production misconfiguration that broke every
    // Paystack payment callback: NEXT_PUBLIC_APP_URL set to "" (present but
    // empty, not merely unset) sent buyers back to an unreachable
    // http://localhost:3000 after paying. Vercel always provides
    // VERCEL_PROJECT_PRODUCTION_URL automatically — it must be used instead.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "snapduka.vercel.app");
    mockRequestHost("evil.example.com", "https");

    expect(await appOrigin()).toBe("https://snapduka.vercel.app");
    // Still must not trust request headers, even with the safety net active.
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("still prefers the explicitly configured URL over the Vercel safety net", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://snapduka.shop");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "snapduka.vercel.app");

    expect(await appOrigin()).toBe("https://snapduka.shop");
  });

  it("respects x-forwarded-proto from a proxy", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mockRequestHost("preview.snapduka.dev", "https");

    expect(await appOrigin()).toBe("https://preview.snapduka.dev");
  });

  it("falls back to the configured URL when no request scope exists", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    mocks.headers.mockRejectedValue(new Error("outside request scope"));

    expect(await appOrigin()).toBe("http://127.0.0.1:3000");
  });

  it("falls back to localhost:3000 with nothing configured and no request", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    mocks.headers.mockRejectedValue(new Error("outside request scope"));

    expect(await appOrigin()).toBe("http://localhost:3000");
  });
});
