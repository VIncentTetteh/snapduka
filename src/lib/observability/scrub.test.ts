import type { Event } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  REDACTED,
  isBodyDropRoute,
  scrubBreadcrumb,
  scrubEvent,
  scrubString,
  scrubUrl,
  scrubValue,
} from "./scrub";

describe("scrubString", () => {
  it.each([
    ["email", "failed for ama.mensah+shop@example.com.gh today"],
    ["Ghana intl", "invalid phone +233 24 123 4567"],
    ["Ghana intl compact", "invalid phone +233241234567"],
    ["Ghana intl no plus", "sms to 233241234567 failed"],
    ["Ghana national", "phone 024 123 4567 rejected"],
    ["Ghana national compact", "phone 0241234567 rejected"],
    ["Nigeria intl", "phone +234 803 123 4567 rejected"],
    ["Nigeria national", "phone 0803-123-4567 rejected"],
    ["Côte d'Ivoire intl", "phone +225 07 08 09 10 11 rejected"],
    ["Côte d'Ivoire national", "phone 07 08 09 10 11 rejected"],
    ["other E.164", "phone +44 7700 900123 rejected"],
    ["Paystack secret", "Paystack said: invalid key sk_live_abc123DEF456"],
    ["Paystack test secret", "key sk_test_0123456789abcdef leaked"],
    ["Meta token", "graph error for EAAGm0PX4ZCpsBAKZBZCZAAZDZD1234567890abc"],
    ["JWT", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl expired"],
  ])("redacts %s", (_label, input) => {
    const out = scrubString(input);
    expect(out).toContain(REDACTED);
    expect(out).not.toMatch(/example\.com|4567|0708|sk_|EAAG|eyJ|900123|abc123/);
  });

  it("keeps the credential scheme but drops a bearer value", () => {
    expect(scrubString("Authorization: Bearer abc.def-ghi")).toBe(`Authorization: Bearer ${REDACTED}`);
  });

  it("redacts credentials passed as query parameters", () => {
    expect(scrubString("GET /x?access_token=abc&page=2")).toBe(`GET /x?access_token=${REDACTED}&page=2`);
  });

  it.each([
    ["UUID", "seller 3fa85f64-5717-4562-b3fc-2c963f66afa6"],
    ["amount in minor units", "charged 12500 GHS"],
    ["unix timestamp", "at 1727000000 seconds"],
    ["order reference", "order SD-0241234567 failed"],
    ["plain words", "Checkout failed: stock unavailable"],
    ["HTTP status", "status 502 from paystack"],
  ])("leaves %s alone", (_label, input) => {
    expect(scrubString(input)).toBe(input);
  });
});

describe("scrubUrl", () => {
  it.each([
    ["/orders/abcDEF123token", "/orders/[token]"],
    ["https://snapduka.com/l/xyz789?utm=ig", "https://snapduka.com/l/[token]?utm=ig"],
    ["/team/invitations/inv_tok_1", "/team/invitations/[token]"],
    ["/api/orders/tok123/receipt", "/api/orders/[token]/receipt"],
  ])("redacts capability tokens in %s", (input, expected) => {
    expect(scrubUrl(input)).toBe(expected);
  });

  it("redacts phone numbers in PostgREST filters", () => {
    expect(scrubUrl("https://x.supabase.co/rest/v1/customers?phone=eq.+233241234567")).not.toContain("241234567");
  });
});

describe("scrubValue", () => {
  it("uses the same key needles as the mobile scrubber", () => {
    const out = scrubValue({
      buyer_snapshot: { city: "Accra" },
      customerPhone: "x",
      contact: "x",
      recipient: "x",
      refresh_token: "x",
      password: "x",
      nested: { email: "a@b.co", items: [{ name: "Ama" }] },
    });
    expect(out).toEqual({
      buyer_snapshot: REDACTED,
      customerPhone: REDACTED,
      contact: REDACTED,
      recipient: REDACTED,
      refresh_token: REDACTED,
      password: REDACTED,
      nested: { email: REDACTED, items: [{ name: REDACTED }] },
    });
  });

  it("matches short keys only whole so shipping and footprint survive", () => {
    expect(scrubValue({ otp: "123456", pin: "1234", shipping: 500, footprint: "x" })).toEqual({
      otp: REDACTED,
      pin: REDACTED,
      shipping: 500,
      footprint: "x",
    });
  });

  it("redacts sensitive values under innocent keys", () => {
    expect(scrubValue({ note: "call me on 0241234567" })).toEqual({ note: `call me on ${REDACTED}` });
  });

  it("stops at the depth limit instead of recursing forever", () => {
    type Nested = { next?: Nested; email?: string };
    const root: Nested = {};
    let cursor = root;
    for (let i = 0; i < 20; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expect(() => scrubValue(root)).not.toThrow();
  });
});

describe("isBodyDropRoute", () => {
  it.each([
    ["https://snapduka.com/api/payments/paystack/webhook", true],
    ["/api/auth/sms-hook", true],
    ["/api/checkout", false],
    ["/api/paymentsx", false],
  ])("%s -> %s", (url, expected) => {
    expect(isBodyDropRoute(url)).toBe(expected);
  });
});

describe("scrubEvent", () => {
  it("drops the whole body on payment webhooks", () => {
    const event: Event = {
      request: {
        url: "https://snapduka.com/api/payments/paystack/webhook",
        data: { event: "charge.success", data: { customer: { email: "a@b.co" }, amount: 100 } },
      },
    };
    expect(scrubEvent(event).request?.data).toBe(REDACTED);
  });

  it("drops the whole body on auth hooks", () => {
    const event: Event = { request: { url: "/api/auth/sms-hook", data: '{"otp":"123456"}' } };
    expect(scrubEvent(event).request?.data).toBe(REDACTED);
  });

  it("walks bodies on other routes", () => {
    const event: Event = { request: { url: "/api/checkout", data: { phone: "0241234567", quantity: 2 } } };
    expect(scrubEvent(event).request?.data).toEqual({ phone: REDACTED, quantity: 2 });
  });

  it("redacts sensitive headers and cookies, keeps the rest", () => {
    const event: Event = {
      request: {
        url: "/api/checkout",
        headers: {
          Authorization: "Bearer x",
          cookie: "sb=1",
          "x-paystack-signature": "sig",
          "x-hub-signature-256": "sig",
          "user-agent": "Mozilla",
        },
        cookies: { sb: "1" },
      },
    };
    const out = scrubEvent(event).request;
    expect(out?.headers).toEqual({
      Authorization: REDACTED,
      cookie: REDACTED,
      "x-paystack-signature": REDACTED,
      "x-hub-signature-256": REDACTED,
      "user-agent": "Mozilla",
    });
    expect(out?.cookies).toEqual({ redacted: REDACTED });
  });

  it("scrubs query strings in every shape Sentry uses", () => {
    expect(scrubEvent({ request: { query_string: "phone=0241234567&page=1" } }).request?.query_string).toBe(
      `phone=${REDACTED}&page=1`,
    );
    expect(scrubEvent({ request: { query_string: { email: "a@b.co", page: "1" } } }).request?.query_string).toEqual({
      email: REDACTED,
      page: "1",
    });
    expect(scrubEvent({ request: { query_string: [["token", "abc"], ["page", "1"]] } }).request?.query_string).toEqual([
      ["token", REDACTED],
      ["page", "1"],
    ]);
  });

  it("reduces the user to an id", () => {
    const out = scrubEvent({ user: { id: "u1", email: "a@b.co", ip_address: "1.2.3.4", username: "ama" } });
    expect(out.user).toEqual({ id: "u1" });
  });

  it("scrubs messages, exception values, extra and custom contexts but not SDK contexts", () => {
    const out = scrubEvent({
      message: "failed for a@b.co",
      exception: { values: [{ type: "Error", value: "bad phone +233241234567" }] },
      extra: { buyerEmail: "a@b.co", attempt: 2 },
      contexts: { os: { name: "Linux" }, order: { phone: "0241234567", id: "o1" } },
      tags: { route: "/orders/tok123", runtime: "node" },
    });
    expect(out.message).toBe(`failed for ${REDACTED}`);
    expect(out.exception?.values?.[0]?.value).toBe(`bad phone ${REDACTED}`);
    expect(out.extra).toEqual({ buyerEmail: REDACTED, attempt: 2 });
    expect(out.contexts?.os).toEqual({ name: "Linux" });
    expect(out.contexts?.order).toEqual({ phone: REDACTED, id: "o1" });
    expect(out.tags).toEqual({ route: "/orders/tok123", runtime: "node" });
  });

  it("scrubs transaction spans (PostgREST filters, auth headers) but keeps OTel names", () => {
    const out = scrubEvent({
      type: "transaction",
      spans: [
        {
          span_id: "1",
          trace_id: "t",
          start_timestamp: 0,
          status: "ok",
          description: "GET https://x.supabase.co/rest/v1/customers?phone=eq.0241234567",
          data: {
            "http.request.header.authorization": "Bearer x",
            "db.name": "postgres",
            "server.address": "x.supabase.co",
          },
        },
      ],
    });
    const span = out.spans?.[0];
    expect(span?.description).not.toContain("0241234567");
    expect(span?.data).toEqual({
      "http.request.header.authorization": REDACTED,
      "db.name": "postgres",
      "server.address": "x.supabase.co",
    });
  });

  it("does not mutate its input", () => {
    const event: Event = { request: { url: "/api/checkout", data: { phone: "0241234567" } } };
    scrubEvent(event);
    expect(event.request?.data).toEqual({ phone: "0241234567" });
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs fetch URLs, navigation targets and data keys", () => {
    const out = scrubBreadcrumb({
      category: "fetch",
      message: "sent to a@b.co",
      data: { url: "/api/orders/tok123", method: "GET", to: "/orders/tok9", phone: "x" },
    });
    expect(out.message).toBe(`sent to ${REDACTED}`);
    expect(out.data).toEqual({ url: "/api/orders/[token]", method: "GET", to: "/orders/[token]", phone: REDACTED });
  });
});
