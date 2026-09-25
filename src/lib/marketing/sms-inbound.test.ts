import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { inboundSmsProvider, sandboxProvider, techieszonProvider } from "./sms-inbound";

const url = new URL("http://localhost/api/sms/inbound/x");

afterEach(() => {
  delete process.env.SMS_INBOUND_SANDBOX_SECRET;
  delete process.env.TECHIESZON_SMS_INBOUND_SECRET;
  delete process.env.VERCEL_ENV;
});

describe("inboundSmsProvider", () => {
  it("knows sandbox and techieszon only", () => {
    expect(inboundSmsProvider("sandbox")?.name).toBe("sandbox");
    expect(inboundSmsProvider("techieszon")?.name).toBe("techieszon");
    expect(inboundSmsProvider("toString")).toBeNull();
    expect(inboundSmsProvider("other")).toBeNull();
  });
});

describe("sandbox provider", () => {
  it("is not_configured without a secret", () => {
    expect(sandboxProvider.verify({ headers: new Headers(), rawBody: "{}", url })).toBe("not_configured");
  });

  it("is never enabled in production", () => {
    process.env.SMS_INBOUND_SANDBOX_SECRET = "s";
    process.env.VERCEL_ENV = "production";
    expect(sandboxProvider.verify({ headers: new Headers({ "x-sms-sandbox-secret": "s" }), rawBody: "{}", url })).toBe(
      "not_configured",
    );
  });

  it("checks the shared secret", () => {
    process.env.SMS_INBOUND_SANDBOX_SECRET = "s3cret";
    expect(sandboxProvider.verify({ headers: new Headers({ "x-sms-sandbox-secret": "s3cret" }), rawBody: "{}", url })).toBe("ok");
    expect(sandboxProvider.verify({ headers: new Headers({ "x-sms-sandbox-secret": "nope" }), rawBody: "{}", url })).toBe("invalid");
    expect(sandboxProvider.verify({ headers: new Headers(), rawBody: "{}", url })).toBe("invalid");
  });

  it("parses one message or a batch", () => {
    expect(sandboxProvider.parse({ rawBody: JSON.stringify({ id: "m1", from: "233201234567", text: "STOP" }), contentType: null })).toEqual([
      { messageId: "m1", from: "233201234567", text: "STOP" },
    ]);
    expect(
      sandboxProvider.parse({
        rawBody: JSON.stringify({ messages: [{ from: "1", text: "a" }, { id: "x", from: "2", text: "b" }] }),
        contentType: "application/json",
      }),
    ).toEqual([
      { messageId: null, from: "1", text: "a" },
      { messageId: "x", from: "2", text: "b" },
    ]);
  });

  it("refuses a malformed body", () => {
    expect(sandboxProvider.parse({ rawBody: "not json", contentType: null })).toBeNull();
    expect(sandboxProvider.parse({ rawBody: JSON.stringify({ text: "STOP" }), contentType: null })).toBeNull();
  });
});

describe("techieszon provider (provisional contract)", () => {
  const sign = (body: string, secret = "tz") => createHmac("sha256", secret).update(body).digest("hex");

  it("is not_configured until the inbound secret is set", () => {
    expect(techieszonProvider.verify({ headers: new Headers(), rawBody: "{}", url })).toBe("not_configured");
  });

  it("verifies an HMAC of the raw body, with or without the sha256= prefix", () => {
    process.env.TECHIESZON_SMS_INBOUND_SECRET = "tz";
    const body = '{"from":"233201234567","message":"STOP"}';
    expect(techieszonProvider.verify({ headers: new Headers({ "x-techieszon-signature": sign(body) }), rawBody: body, url })).toBe("ok");
    expect(
      techieszonProvider.verify({ headers: new Headers({ "x-techieszon-signature": `sha256=${sign(body)}` }), rawBody: body, url }),
    ).toBe("ok");
    expect(
      techieszonProvider.verify({ headers: new Headers({ "x-techieszon-signature": sign(body, "other") }), rawBody: body, url }),
    ).toBe("invalid");
    expect(techieszonProvider.verify({ headers: new Headers(), rawBody: body, url })).toBe("invalid");
  });

  it("accepts common MO field names in JSON and form bodies, and skips delivery reports", () => {
    expect(
      techieszonProvider.parse({ rawBody: '{"msisdn":"233201234567","text":"stop","message_id":"9"}', contentType: "application/json" }),
    ).toEqual([{ messageId: "9", from: "233201234567", text: "stop" }]);
    expect(
      techieszonProvider.parse({ rawBody: "sender=233201234567&message=START&id=7", contentType: "application/x-www-form-urlencoded" }),
    ).toEqual([{ messageId: "7", from: "233201234567", text: "START" }]);
    expect(techieszonProvider.parse({ rawBody: '{"msisdn":"233201234567","status":"DELIVRD"}', contentType: "application/json" })).toEqual(
      [],
    );
    expect(techieszonProvider.parse({ rawBody: "nope", contentType: "application/json" })).toBeNull();
  });
});
