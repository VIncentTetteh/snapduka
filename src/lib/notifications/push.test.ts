import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { sendPush } from "./push";

const EXPO_TOKEN = "ExponentPushToken[abc123]";
const WEB_ENDPOINT = "https://fcm.googleapis.com/fcm/send/xyz";

function expoResponds(ticket: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data: [ticket] }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eq.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.createAdminClient.mockReturnValue({ from: () => ({ update: mocks.update }) });
});

afterEach(() => {
  delete process.env.PUSH_WEBHOOK_URL;
  vi.unstubAllGlobals();
});

describe("sendPush — Expo tokens", () => {
  it("posts the notification to Expo with the order in the data payload", async () => {
    const fetchMock = expoResponds({ status: "ok" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendPush(EXPO_TOKEN, "New order", "SD-ABC is paid", "https://x/orders/t", {
        orderId: "order-1",
      }),
    ).resolves.toEqual({ delivered: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(JSON.parse(init.body)).toEqual([
      expect.objectContaining({
        to: EXPO_TOKEN,
        title: "New order",
        body: "SD-ABC is paid",
        data: { orderId: "order-1", url: "https://x/orders/t" },
      }),
    ]);
  });

  // Expo answers HTTP 200 with a per-message error inside. Trusting the status
  // code alone yields a queue that says "sent" while nothing was delivered.
  it("throws when the ticket reports a failure despite a 200", async () => {
    vi.stubGlobal("fetch", expoResponds({ status: "error", message: "Message too big" }));

    await expect(sendPush(EXPO_TOKEN, "t", "b")).rejects.toThrow("Message too big");
  });

  it("throws when Expo itself is unavailable", async () => {
    vi.stubGlobal("fetch", expoResponds({ status: "ok" }, 503));

    await expect(sendPush(EXPO_TOKEN, "t", "b")).rejects.toThrow(/503/);
  });

  describe("DeviceNotRegistered", () => {
    const ticket = {
      status: "error",
      message: "not registered",
      details: { error: "DeviceNotRegistered" },
    };

    it("reports not_configured so the worker dead-letters instead of retrying", async () => {
      vi.stubGlobal("fetch", expoResponds(ticket));

      await expect(sendPush(EXPO_TOKEN, "t", "b")).resolves.toEqual({
        delivered: false,
        reason: "not_configured",
      });
    });

    it("deactivates the dead token so it is not targeted again", async () => {
      vi.stubGlobal("fetch", expoResponds(ticket));

      await sendPush(EXPO_TOKEN, "t", "b");

      expect(mocks.update).toHaveBeenCalledWith({ active: false });
      expect(mocks.eq).toHaveBeenCalledWith("expo_push_token", EXPO_TOKEN);
    });

    it("still reports the outcome if deactivation fails", async () => {
      vi.stubGlobal("fetch", expoResponds(ticket));
      mocks.createAdminClient.mockImplementation(() => {
        throw new Error("db down");
      });

      await expect(sendPush(EXPO_TOKEN, "t", "b")).resolves.toEqual({
        delivered: false,
        reason: "not_configured",
      });
    });
  });
});

describe("sendPush — web push endpoints", () => {
  it("relays to the configured webhook, unchanged", async () => {
    process.env.PUSH_WEBHOOK_URL = "https://relay.example/push";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendPush(WEB_ENDPOINT, "t", "b", "https://x")).resolves.toEqual({
      delivered: true,
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://relay.example/push");
  });

  it("reports not_configured when no relay is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendPush(WEB_ENDPOINT, "t", "b")).resolves.toEqual({
      delivered: false,
      reason: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A web endpoint must never be sent to Expo, and vice versa.
  it("does not route a web endpoint through Expo", async () => {
    process.env.PUSH_WEBHOOK_URL = "https://relay.example/push";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await sendPush(WEB_ENDPOINT, "t", "b");

    expect(fetchMock.mock.calls[0][0]).not.toContain("exp.host");
  });
});
