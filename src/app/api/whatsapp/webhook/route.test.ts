import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  after: vi.fn(),
  drainDomainEvents: vi.fn(),
  vault: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("@/lib/events/process", () => ({ drainDomainEvents: mocks.drainDomainEvents }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
// Vault is read through its own module, so storage assertions below see only
// the webhook's own RPCs.
vi.mock("@/lib/whatsapp/vault", () => ({
  readWhatsAppVaultSecrets: mocks.vault,
  cachedWhatsAppVaultSecrets: () => null,
}));

import { GET, POST } from "./route";

const SECRET = "app-secret";

function body(messages: unknown[] = [], statuses: unknown[] = []) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, messages, statuses } }] }],
  });
}

function post(raw: string, signature = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`) {
  return POST(
    new Request("http://localhost/api/whatsapp/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: raw,
    }),
  );
}

const TEXT = { from: "233201234567", id: "wamid.A", timestamp: "1758800000", type: "text", text: { body: "SHOP-K7M2 hi" } };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHATSAPP_APP_SECRET = SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "PNID";
  process.env.WHATSAPP_ACCESS_TOKEN = "t";
  mocks.rpc.mockResolvedValue({ data: [{ duplicate: false, message_id: "m1", conversation_id: "c1" }], error: null });
  mocks.vault.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"]) {
    delete process.env[key];
  }
});

describe("GET /api/whatsapp/webhook", () => {
  it("echoes the challenge for the right verify token", async () => {
    const response = await GET(
      new Request("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("12345");
  });

  it("accepts the Vault verify token", async () => {
    mocks.vault.mockResolvedValue({ appSecret: null, accessToken: null, verifyToken: "from-vault" });
    const response = await GET(
      new Request("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=from-vault&hub.challenge=9"),
    );
    expect(response.status).toBe(200);
  });

  it("refuses a wrong token", async () => {
    const response = await GET(
      new Request("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"),
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /api/whatsapp/webhook", () => {
  it("stores a signed message, applies receipts, returns 200 and kicks the drain", async () => {
    const response = await post(body([TEXT], [{ id: "wamid.OUT", status: "read" }]));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("wa_record_inbound", {
      p_wamid: "wamid.A",
      p_from: "+233201234567",
      p_type: "text",
      p_body: "SHOP-K7M2 hi",
      p_media_id: undefined,
      p_media_mime: undefined,
      p_sent_at: new Date(1758800000 * 1000).toISOString(),
    });
    expect(mocks.rpc).toHaveBeenCalledWith("wa_apply_status", { p_wamid: "wamid.OUT", p_status: "read", p_error: undefined });
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  // The URL is public: an unsigned request could inject buyer messages into any
  // seller's inbox and spend their AI budget.
  it("401s a bad signature and stores nothing", async () => {
    const response = await post(body([TEXT]), "sha256=deadbeef");
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("verifies with the Vault app secret in preference to env", async () => {
    mocks.vault.mockResolvedValue({ appSecret: "vault-secret", accessToken: null, verifyToken: null });
    const raw = body([TEXT]);
    // Signed with the env secret: refused, because Vault's value wins.
    expect((await post(raw)).status).toBe(401);
    const signed = `sha256=${createHmac("sha256", "vault-secret").update(raw).digest("hex")}`;
    expect((await post(raw, signed)).status).toBe(200);
  });

  it("uses a Vault-only secret when env has none", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    mocks.vault.mockResolvedValue({ appSecret: "vault-secret", accessToken: null, verifyToken: null });
    const raw = body([TEXT]);
    const signed = `sha256=${createHmac("sha256", "vault-secret").update(raw).digest("hex")}`;
    expect((await post(raw, signed)).status).toBe(200);
  });

  it("503s when the app secret is not configured", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    expect((await post(body([TEXT]))).status).toBe(503);
  });

  it("does not kick the drain for a redelivered message", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ duplicate: true }], error: null });
    expect((await post(body([TEXT]))).status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  // Meta redelivers on non-2xx, and the wamid dedupe makes that safe.
  it("500s when storage fails, so Meta retries", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await post(body([TEXT]))).status).toBe(500);
  });
});
