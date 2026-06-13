import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { proxy } from "./proxy";

describe("auth proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";

    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: null });
    mocks.createServerClient.mockImplementation(
      (_url: string, _key: string, options: {
        cookies: {
          setAll: (
            cookies: Array<{
              name: string;
              value: string;
              options: { path: string };
            }>,
            headers: Record<string, string>,
          ) => void;
        };
      }) => {
        options.cookies.setAll(
          [
            {
              name: "sb-session",
              value: "refreshed",
              options: { path: "/" },
            },
          ],
          {
            "cache-control": "private, no-store",
            vary: "Cookie",
          },
        );

        return { auth: { getClaims: mocks.getClaims } };
      },
    );
  });

  it("refreshes the verified auth cookie and otherwise continues the request", async () => {
    const response = await proxy(
      new NextRequest("https://snapduka.example/dashboard"),
    );

    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.cookies.get("sb-session")?.value).toBe("refreshed");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("location")).toBeNull();
  });
});
