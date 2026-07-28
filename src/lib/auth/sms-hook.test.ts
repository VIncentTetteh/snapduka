import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildOtpMessage, parseSmsHookPayload, verifyStandardWebhook } from "./sms-hook";

const KEY = Buffer.from("super-secret-signing-key").toString("base64");
const SECRET = `v1,whsec_${KEY}`;

function sign(id: string, timestamp: string, body: string): string {
  const key = Buffer.from(KEY, "base64");
  const sig = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${sig}`;
}

describe("sms-hook verification", () => {
  const body = JSON.stringify({ user: { phone: "233542880528" }, sms: { otp: "123456" } });
  const now = 1_700_000_000_000;
  const ts = String(Math.floor(now / 1000));

  it("accepts a correctly signed, in-window request", () => {
    const ok = verifyStandardWebhook(
      { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) },
      body,
      SECRET,
      now,
    );
    expect(ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ok = verifyStandardWebhook(
      { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) },
      body.replace("123456", "000000"),
      SECRET,
      now,
    );
    expect(ok).toBe(false);
  });

  it("rejects an expired timestamp (replay)", () => {
    const oldTs = String(Math.floor(now / 1000) - 3600);
    const ok = verifyStandardWebhook(
      { id: "msg_1", timestamp: oldTs, signature: sign("msg_1", oldTs, body) },
      body,
      SECRET,
      now,
    );
    expect(ok).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(verifyStandardWebhook({ id: null, timestamp: ts, signature: "x" }, body, SECRET, now)).toBe(false);
  });

  it("parses phone + otp and builds a message", () => {
    expect(parseSmsHookPayload(JSON.parse(body))).toEqual({ phone: "233542880528", otp: "123456" });
    expect(parseSmsHookPayload({ user: {} })).toBeNull();
    expect(buildOtpMessage("123456")).toContain("123456");
  });
});
