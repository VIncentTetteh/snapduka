import { defineConfig, devices } from "@playwright/test";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required. Run pnpm test:e2e.`);
  return value;
}

const e2ePort = Number(process.env.E2E_PORT ?? 3100);
const e2eUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: e2eUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${e2ePort}`,
    url: e2eUrl,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: requiredEnv(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      ),
      SUPABASE_SECRET_KEY: requiredEnv("SUPABASE_SECRET_KEY"),
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? e2eUrl,
    },
  },
});
