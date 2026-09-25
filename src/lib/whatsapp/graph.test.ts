import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sendGraphTemplate, sendGraphText } from "./graph";

const CONFIG = { phoneNumberId: "PNID", accessToken: "secret-token" };

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("sendGraphText", () => {
  it("posts to /{phone-number-id}/messages with the bearer token", async () => {
    const fetchMock = respond(200, { messages: [{ id: "wamid.X" }] });

    await expect(sendGraphText(CONFIG, "+233201234567", "hello")).resolves.toEqual({ ok: true, wamid: "wamid.X" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/PNID\/messages$/);
    expect(init.headers.authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "233201234567",
      type: "text",
      text: { preview_url: true, body: "hello" },
    });
  });

  it("returns outside_window for Meta's re-engagement error", async () => {
    respond(400, { error: { code: 131047, message: "Re-engagement message" } });
    await expect(sendGraphText(CONFIG, "+233201234567", "hi")).resolves.toMatchObject({
      ok: false,
      reason: "outside_window",
    });
  });

  it("returns auth_failed for an expired token", async () => {
    respond(401, { error: { code: 190 } });
    await expect(sendGraphText(CONFIG, "+233201234567", "hi")).resolves.toMatchObject({ reason: "auth_failed" });
  });

  it("returns rejected for other permanent errors", async () => {
    respond(400, { error: { code: 131026 } });
    await expect(sendGraphText(CONFIG, "+233201234567", "hi")).resolves.toMatchObject({ reason: "rejected" });
  });

  it.each([
    [500, 1],
    [429, 130429],
    [400, 131056],
  ])("throws on transient failure %i/%i so the caller retries", async (status, code) => {
    respond(status, { error: { code } });
    await expect(sendGraphText(CONFIG, "+233201234567", "hi")).rejects.toThrow(/temporarily/);
  });

  it("never lets a network error echo the token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED Bearer secret-token")));
    await expect(sendGraphText(CONFIG, "+233201234567", "hi")).rejects.toThrow("WhatsApp request failed.");
  });
});

describe("sendGraphTemplate", () => {
  it("sends positional body parameters in the template's language", async () => {
    const fetchMock = respond(200, { messages: [{ id: "wamid.T" }] });

    await sendGraphTemplate(CONFIG, "+233201234567", {
      name: "delivery_code",
      params: { reference: "SD-1", code: "123456" },
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).template).toEqual({
      name: "delivery_code",
      language: { code: "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: "123456" }, { type: "text", text: "SD-1" }] },
      ],
    });
  });
});
