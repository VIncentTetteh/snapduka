import { describe, expect, it } from "vitest";

import { parseWebhook } from "./inbound";

function payload(value: Record<string, unknown>, phoneNumberId = "PNID") {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, ...value } }] }],
  };
}

describe("parseWebhook", () => {
  it("normalises a text message to E.164 and ISO time", () => {
    const parsed = parseWebhook(
      payload({ messages: [{ from: "233201234567", id: "wamid.A", timestamp: "1758800000", type: "text", text: { body: "Hi SHOP-K7M2" } }] }),
      "PNID",
    );
    expect(parsed.messages).toEqual([
      {
        wamid: "wamid.A",
        from: "+233201234567",
        type: "text",
        body: "Hi SHOP-K7M2",
        mediaId: null,
        mediaMime: null,
        sentAt: new Date(1758800000 * 1000).toISOString(),
      },
    ]);
  });

  it("marks a voice note as voice, keeping the media id", () => {
    const parsed = parseWebhook(
      payload({ messages: [{ from: "233201234567", id: "wamid.V", type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg", voice: true } }] }),
      "PNID",
    );
    expect(parsed.messages[0]).toMatchObject({ type: "voice", mediaId: "MEDIA1", mediaMime: "audio/ogg", body: "" });
  });

  it("keeps an image caption as the body", () => {
    const parsed = parseWebhook(
      payload({ messages: [{ from: "233201234567", id: "wamid.I", type: "image", image: { id: "M", caption: "this one in black?" } }] }),
      null,
    );
    expect(parsed.messages[0]).toMatchObject({ type: "image", body: "this one in black?" });
  });

  it("reads a button reply's title", () => {
    const parsed = parseWebhook(
      payload({ messages: [{ from: "233201234567", id: "wamid.B", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "x", title: "Yes please" } } }] }),
      null,
    );
    expect(parsed.messages[0]).toMatchObject({ type: "interactive", body: "Yes please" });
  });

  // Meta adds types without notice; a strict parser would 400 and be retried for days.
  it("stores an unknown type as unsupported instead of failing", () => {
    const parsed = parseWebhook(payload({ messages: [{ from: "233201234567", id: "wamid.U", type: "order" }] }), null);
    expect(parsed.messages[0]).toMatchObject({ type: "unsupported" });
  });

  it("skips a malformed message without dropping the rest", () => {
    const parsed = parseWebhook(
      payload({ messages: [{ id: "no-from" }, { from: "233201234567", id: "wamid.OK", type: "text", text: { body: "x" } }] }),
      null,
    );
    expect(parsed.messages.map((message) => message.wamid)).toEqual(["wamid.OK"]);
  });

  it("reads delivery receipts and their errors", () => {
    const parsed = parseWebhook(
      payload({
        statuses: [
          { id: "wamid.S1", status: "delivered" },
          { id: "wamid.S2", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] },
          { id: "wamid.S3", status: "deleted" },
        ],
      }),
      null,
    );
    expect(parsed.statuses).toEqual([
      { wamid: "wamid.S1", status: "delivered", error: null },
      { wamid: "wamid.S2", status: "failed", error: "131047 Re-engagement message" },
    ]);
  });

  it("ignores changes for another number on the same business account", () => {
    const parsed = parseWebhook(
      payload({ messages: [{ from: "233201234567", id: "wamid.X", type: "text", text: { body: "x" } }] }, "OTHER"),
      "PNID",
    );
    expect(parsed.messages).toEqual([]);
  });

  it("ignores payloads that are not WhatsApp", () => {
    expect(parseWebhook({ object: "page", entry: [] }, null)).toEqual({ messages: [], statuses: [] });
    expect(parseWebhook("nonsense", null)).toEqual({ messages: [], statuses: [] });
  });
});
