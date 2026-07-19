import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { GET } from "./route";

describe("auth confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exchanges a PKCE code and rejects an unsafe next redirect", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    createClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });

    const response = await GET(
      new NextRequest(
        "https://snapduka.example/auth/confirm?code=auth-code&next=//evil.example",
      ),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("auth-code");
    expect(response.headers.get("location")).toBe(
      "https://snapduka.example/",
    );
  });

  it("treats a token_hash-only request as invalid now that OTP links are not supported", async () => {
    createClient.mockResolvedValue({
      auth: { exchangeCodeForSession: vi.fn() },
    });

    const request = new NextRequest(
      "https://snapduka.example/auth/confirm?token_hash=abc123&type=email&next=%2Fonboarding",
    );
    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
    expect(response.headers.get("location")).toContain(
      "invalid+or+has+expired",
    );
  });

  it("sends a confirmed first-time user to onboarding by default", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    createClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });

    const response = await GET(
      new NextRequest(
        "https://snapduka.example/auth/confirm?code=auth-code",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://snapduka.example/onboarding",
    );
  });
});
