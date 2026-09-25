import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { POST } from "./route";

const SECRET = "sandbox-secret";

function post(provider: string, body: unknown, headers: Record<string, string> = { "x-sms-sandbox-secret": SECRET }) {
  return POST(
    new Request(`http://localhost/api/sms/inbound/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ provider }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SMS_INBOUND_SANDBOX_SECRET = SECRET;
  mocks.rpc.mockResolvedValue({ data: [{ duplicate: false, opted_out: true, consents_withdrawn: 1 }], error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.SMS_INBOUND_SANDBOX_SECRET;
  delete process.env.TECHIESZON_SMS_INBOUND_SECRET;
});

describe("POST /api/sms/inbound/[provider]", () => {
  it("404s an unknown provider", async () => {
    expect((await post("nobody", {})).status).toBe(404);
  });

  it("503s a provider that is not configured, rather than accepting and ignoring STOPs", async () => {
    const response = await post("techieszon", { from: "233201234567", message: "STOP" }, {});
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("401s a bad secret without touching storage", async () => {
    const response = await post("sandbox", { from: "233201234567", text: "STOP" }, { "x-sms-sandbox-secret": "wrong" });
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("400s a payload the provider does not recognise", async () => {
    expect((await post("sandbox", "not json")).status).toBe(400);
  });

  it("applies a STOP as a platform opt-out, deduped on the message id", async () => {
    const response = await post("sandbox", { id: "mo-1", from: "233201234567", text: "Stop" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, applied: 1, duplicates: 0, ignored: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith("sms_apply_opt_keyword", {
      p_phone: "+233201234567",
      p_action: "opt_out",
      p_source: "inbound_sms",
      p_keyword: "STOP",
      p_provider: "sandbox",
      p_provider_message_id: "mo-1",
      p_actor: undefined,
    });
  });

  it("applies a bare START as an opt-in", async () => {
    await post("sandbox", { from: "+233201234567", text: "START" });
    expect(mocks.rpc).toHaveBeenCalledWith("sms_apply_opt_keyword", expect.objectContaining({ p_action: "opt_in", p_keyword: "START" }));
  });

  it("ignores ordinary replies and local-format numbers without storing them", async () => {
    const response = await post("sandbox", {
      messages: [
        { from: "233201234567", text: "Is the blue one still available?" },
        { from: "0201234567", text: "STOP" },
      ],
    });
    expect(await response.json()).toEqual({ ok: true, applied: 0, duplicates: 0, ignored: 2 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reports a redelivery as a duplicate", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ duplicate: true, opted_out: true, consents_withdrawn: 0 }], error: null });
    const response = await post("sandbox", { id: "mo-1", from: "233201234567", text: "STOP" });
    expect(await response.json()).toEqual({ ok: true, applied: 0, duplicates: 1, ignored: 0 });
  });

  it("500s on a storage failure so the provider redelivers", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await post("sandbox", { from: "233201234567", text: "STOP" })).status).toBe(500);
  });

  it("413s an oversized body", async () => {
    const response = await post("sandbox", { from: "233201234567", text: "x".repeat(70_000) });
    expect(response.status).toBe(413);
  });
});
