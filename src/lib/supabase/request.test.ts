import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  createCookieClient: vi.fn(),
  createTokenClient: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("./server", () => ({ createClient: mocks.createCookieClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createTokenClient }));

import { bearerJwtFrom, createRequestScopedClient, requestBearerJwt } from "./request";

/** A structurally valid JWS compact serialisation. Never verified locally. */
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl-x_1";

/** The real shape from lib/api-keys/keys.ts: sdk_live_<uuid>_<base64url>. */
const API_KEY =
  "sdk_live_11111111-1111-4111-8111-111111111111_dGhpc2lzbm90YWp3dGF0YWxs";

function withAuthorization(value: string | null) {
  mocks.headers.mockResolvedValue({ get: (name: string) => (name === "authorization" ? value : null) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  mocks.createCookieClient.mockResolvedValue({ kind: "cookie" });
  mocks.createTokenClient.mockReturnValue({ kind: "token" });
});

describe("bearerJwtFrom", () => {
  it("accepts a three-segment JWS", () => {
    expect(bearerJwtFrom(`Bearer ${JWT}`)).toBe(JWT);
  });

  it("is case- and whitespace-insensitive about the scheme", () => {
    expect(bearerJwtFrom(`  bearer   ${JWT}  `)).toBe(JWT);
  });

  it.each([
    ["a seller API key", `Bearer ${API_KEY}`],
    ["an opaque token", "Bearer abc123"],
    ["a two-segment token", "Bearer aaa.bbb"],
    ["a four-segment token", "Bearer aaa.bbb.ccc.ddd"],
    ["a non-Bearer scheme", `Basic ${JWT}`],
    ["a bare token", JWT],
    ["an empty header", ""],
  ])("rejects %s", (_label, header) => {
    expect(bearerJwtFrom(header)).toBeNull();
  });

  it("rejects a missing header", () => {
    expect(bearerJwtFrom(null)).toBeNull();
    expect(bearerJwtFrom(undefined)).toBeNull();
  });
});

describe("createRequestScopedClient", () => {
  it("uses the cookie client when there is no Authorization header", async () => {
    withAuthorization(null);

    await expect(createRequestScopedClient()).resolves.toEqual({ kind: "cookie" });
    expect(mocks.createTokenClient).not.toHaveBeenCalled();
  });

  it("uses a token client that forwards the JWT to PostgREST", async () => {
    withAuthorization(`Bearer ${JWT}`);

    await expect(createRequestScopedClient()).resolves.toEqual({ kind: "token" });
    expect(mocks.createCookieClient).not.toHaveBeenCalled();
    expect(mocks.createTokenClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "publishable-key",
      expect.objectContaining({
        global: { headers: { Authorization: `Bearer ${JWT}` } },
        auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }),
      }),
    );
  });

  // The important one. Seller API keys are also sent as `Authorization: Bearer`;
  // treating one as a Supabase JWT would send a raw API key to the auth server
  // and hand the request a client authenticated as nobody.
  it("falls back to cookies when the Bearer token is a seller API key", async () => {
    withAuthorization(`Bearer ${API_KEY}`);

    await expect(createRequestScopedClient()).resolves.toEqual({ kind: "cookie" });
    expect(mocks.createTokenClient).not.toHaveBeenCalled();
  });

  it("throws a named error when Supabase env vars are missing", async () => {
    withAuthorization(`Bearer ${JWT}`);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    await expect(createRequestScopedClient()).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });
});

describe("requestBearerJwt", () => {
  it("reads the token off the incoming request", async () => {
    withAuthorization(`Bearer ${JWT}`);
    await expect(requestBearerJwt()).resolves.toBe(JWT);
  });

  it("is null for a cookie-authenticated request", async () => {
    withAuthorization(null);
    await expect(requestBearerJwt()).resolves.toBeNull();
  });
});
