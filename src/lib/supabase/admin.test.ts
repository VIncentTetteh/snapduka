import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAdminClient } from "./admin";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalSecret = process.env.SUPABASE_SECRET_KEY;

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  process.env.SUPABASE_SECRET_KEY = originalSecret;
});

describe("admin Supabase client", () => {
  it("does not require secrets until the admin client is requested", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    delete process.env.SUPABASE_SECRET_KEY;

    expect(createAdminClient).toBeTypeOf("function");
    expect(() => createAdminClient()).toThrowError(
      "Missing required environment variable: SUPABASE_SECRET_KEY",
    );
  });
});
