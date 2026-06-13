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

  it("verifies an email token hash before redirecting", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    createClient.mockResolvedValue({
      auth: { verifyOtp },
    });

    const response = await GET(
      new NextRequest(
        "https://snapduka.example/auth/confirm?token_hash=hash&type=email&next=/settings",
      ),
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "hash",
      type: "email",
    });
    expect(response.headers.get("location")).toBe(
      "https://snapduka.example/settings",
    );
  });
});
