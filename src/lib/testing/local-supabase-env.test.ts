import { describe, expect, test } from "vitest";

import { parseLocalSupabaseEnv } from "../../../scripts/local-supabase-env.mjs";

describe("parseLocalSupabaseEnv", () => {
  test("maps Supabase status output to application environment variables", () => {
    expect(
      parseLocalSupabaseEnv(`
API_URL="http://127.0.0.1:54321"
PUBLISHABLE_KEY="local-publishable"
SECRET_KEY="local-secret"
`),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
    });
  });

  test("supports legacy anon and service role key names", () => {
    expect(
      parseLocalSupabaseEnv(`
API_URL="http://127.0.0.1:54321"
ANON_KEY="legacy-anon"
SERVICE_ROLE_KEY="legacy-service"
`),
    ).toMatchObject({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "legacy-anon",
      SUPABASE_SECRET_KEY: "legacy-service",
    });
  });
});
