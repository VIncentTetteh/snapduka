import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createAdminClient: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import {
  cachedWhatsAppVaultSecrets,
  readWhatsAppVaultSecrets,
  resetWhatsAppVaultCache,
  VAULT_CACHE_TTL_MS,
  VAULT_FAILURE_TTL_MS,
} from "./vault";
import { loadWhatsAppAppSecret, loadWhatsAppCloudConfig, whatsAppAppSecret } from "./config";

const ROW = { app_secret: "vault-app", access_token: "vault-token", verify_token: null };

beforeEach(() => {
  vi.clearAllMocks();
  resetWhatsAppVaultCache();
  mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: [ROW], error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  process.env.WHATSAPP_PHONE_NUMBER_ID = "PNID";
});

describe("readWhatsAppVaultSecrets", () => {
  it("reads through the service-role function", async () => {
    await expect(readWhatsAppVaultSecrets(0)).resolves.toEqual({
      appSecret: "vault-app",
      accessToken: "vault-token",
      verifyToken: null,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("whatsapp_platform_secrets");
  });

  it("caches for the TTL, then reads again (so a rotation lands within minutes)", async () => {
    await readWhatsAppVaultSecrets(0);
    await readWhatsAppVaultSecrets(VAULT_CACHE_TTL_MS - 1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await readWhatsAppVaultSecrets(VAULT_CACHE_TTL_MS + 1);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("shares one read between concurrent callers", async () => {
    await Promise.all([readWhatsAppVaultSecrets(0), readWhatsAppVaultSecrets(0), readWhatsAppVaultSecrets(0)]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns null on an error, and retries sooner than a success", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    await expect(readWhatsAppVaultSecrets(0)).resolves.toBeNull();
    await readWhatsAppVaultSecrets(VAULT_FAILURE_TTL_MS - 1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await readWhatsAppVaultSecrets(VAULT_FAILURE_TTL_MS + 1);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("returns null, never throws, without Supabase env", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY");
    });
    await expect(readWhatsAppVaultSecrets(0)).resolves.toBeNull();
  });

  it("exposes the cached value to sync callers only while fresh", async () => {
    expect(cachedWhatsAppVaultSecrets(0)).toBeNull();
    await readWhatsAppVaultSecrets(0);
    expect(cachedWhatsAppVaultSecrets(1)?.appSecret).toBe("vault-app");
    expect(cachedWhatsAppVaultSecrets(VAULT_CACHE_TTL_MS + 1)).toBeNull();
  });
});

describe("config precedence", () => {
  it("prefers Vault over env", async () => {
    process.env.WHATSAPP_APP_SECRET = "env-app";
    await expect(loadWhatsAppAppSecret()).resolves.toBe("vault-app");
    await expect(loadWhatsAppCloudConfig()).resolves.toEqual({ phoneNumberId: "PNID", accessToken: "vault-token" });
  });

  it("falls back to env per secret when Vault has none", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ app_secret: null, access_token: null, verify_token: null }], error: null });
    process.env.WHATSAPP_APP_SECRET = "env-app";
    process.env.WHATSAPP_ACCESS_TOKEN = "env-token";
    await expect(loadWhatsAppAppSecret()).resolves.toBe("env-app");
    await expect(loadWhatsAppCloudConfig()).resolves.toEqual({ phoneNumberId: "PNID", accessToken: "env-token" });
  });

  it("falls back to env when Vault is unreachable", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    process.env.WHATSAPP_APP_SECRET = "env-app";
    await expect(loadWhatsAppAppSecret()).resolves.toBe("env-app");
  });

  it("is not configured with neither", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ app_secret: null, access_token: null, verify_token: null }], error: null });
    await expect(loadWhatsAppAppSecret()).resolves.toBeNull();
    await expect(loadWhatsAppCloudConfig()).resolves.toBeNull();
  });

  it("the sync accessor sees Vault once a load has warmed the cache", async () => {
    process.env.WHATSAPP_APP_SECRET = "env-app";
    expect(whatsAppAppSecret()).toBe("env-app");
    await loadWhatsAppAppSecret();
    expect(whatsAppAppSecret()).toBe("vault-app");
  });
});
