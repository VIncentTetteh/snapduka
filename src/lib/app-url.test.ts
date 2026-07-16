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
    mockRequestHost("evil.example.com", "https");

    // Host-header poisoning must not shape generated links (e.g. auth emails).
    expect(await appOrigin()).toBe("http://localhost:3000");
    expect(mocks.headers).not.toHaveBeenCalled();
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
