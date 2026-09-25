import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * Inbound SMS (keyword replies) from each provider, normalised.
 *
 * Every provider gets a `verify` and a `parse`. Verification is over the raw
 * body, before parsing, and fails closed: an unverified request that could
 * send START would re-subscribe numbers that opted out, and one that could
 * send STOP would let anyone silence a shop's customers.
 *
 * Providers:
 *  - `sandbox`  — for local development and staging tests. Shared-secret
 *    header, JSON body. Disabled in production builds whatever the env says.
 *  - `techieszon` — PROVISIONAL. Techieszon has not published its inbound/MO
 *    or delivery-report webhook contract. Until it does, this reports
 *    not_configured unless TECHIESZON_SMS_INBOUND_SECRET is set, and when it
 *    is, it verifies an HMAC-SHA256 of the raw body in `x-techieszon-signature`
 *    (hex, optionally `sha256=`-prefixed) and accepts the field names SMS
 *    gateways commonly use. Confirm both against Techieszon before pointing
 *    their dashboard at this URL.
 */

export type InboundSms = {
  /** The provider's id for the message, used to dedupe redeliveries. */
  messageId: string | null;
  from: string;
  text: string;
};

export type VerifyResult = "ok" | "invalid" | "not_configured";

export type InboundSmsProvider = {
  name: string;
  verify(input: { headers: Headers; rawBody: string; url: URL }): VerifyResult;
  /** Null when the body is not in this provider's shape at all. */
  parse(input: { rawBody: string; contentType: string | null }): InboundSms[] | null;
};

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const MAX_MESSAGES_PER_CALL = 100;
const MAX_TEXT = 1600;

const sandboxMessage = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  from: z.string().trim().min(1).max(32),
  text: z.string().max(MAX_TEXT),
});
const sandboxBody = z.union([
  z.object({ messages: z.array(sandboxMessage).min(1).max(MAX_MESSAGES_PER_CALL) }),
  sandboxMessage,
]);

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return undefined;
  }
}

export const sandboxProvider: InboundSmsProvider = {
  name: "sandbox",
  verify({ headers }) {
    const secret = process.env.SMS_INBOUND_SANDBOX_SECRET;
    // A sandbox that can opt real numbers in and out is an operator tool with
    // a static password; production has the admin action for that instead.
    if (!secret || process.env.VERCEL_ENV === "production") return "not_configured";
    const received = headers.get("x-sms-sandbox-secret");
    return received && safeEqual(received, secret) ? "ok" : "invalid";
  },
  parse({ rawBody }) {
    const parsed = sandboxBody.safeParse(parseJson(rawBody));
    if (!parsed.success) return null;
    const list = "messages" in parsed.data ? parsed.data.messages : [parsed.data];
    return list.map((message) => ({ messageId: message.id ?? null, from: message.from, text: message.text }));
  },
};

// Field names seen across SMS gateways for an MO (mobile-originated) message.
const TECHIESZON_FROM = ["from", "sender", "msisdn", "phone", "source"] as const;
const TECHIESZON_TEXT = ["message", "text", "sms", "body", "content"] as const;
const TECHIESZON_ID = ["message_id", "messageId", "id", "sms_id", "reference"] as const;

function pick(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function techieszonRecords(rawBody: string, contentType: string | null): Record<string, unknown>[] | null {
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    return [Object.fromEntries(new URLSearchParams(rawBody))];
  }
  const json = parseJson(rawBody);
  if (Array.isArray(json)) return json.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  if (json && typeof json === "object") {
    const record = json as Record<string, unknown>;
    if (Array.isArray(record.messages)) {
      return record.messages.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
    }
    return [record];
  }
  return null;
}

export const techieszonProvider: InboundSmsProvider = {
  name: "techieszon",
  verify({ headers, rawBody }) {
    const secret = process.env.TECHIESZON_SMS_INBOUND_SECRET;
    if (!secret) return "not_configured";
    const header = headers.get("x-techieszon-signature");
    if (!header) return "invalid";
    const received = header.startsWith("sha256=") ? header.slice("sha256=".length) : header;
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    return safeEqual(received.toLowerCase(), expected) ? "ok" : "invalid";
  },
  parse({ rawBody, contentType }) {
    const records = techieszonRecords(rawBody, contentType);
    if (!records) return null;
    const messages: InboundSms[] = [];
    for (const record of records.slice(0, MAX_MESSAGES_PER_CALL)) {
      const from = pick(record, TECHIESZON_FROM);
      const text = pick(record, TECHIESZON_TEXT);
      // A delivery report (no text) is not a keyword; nothing to apply.
      if (!from || text === null) continue;
      messages.push({ messageId: pick(record, TECHIESZON_ID), from, text: text.slice(0, MAX_TEXT) });
    }
    return messages;
  },
};

const PROVIDERS: Record<string, InboundSmsProvider> = {
  sandbox: sandboxProvider,
  techieszon: techieszonProvider,
};

export function inboundSmsProvider(name: string): InboundSmsProvider | null {
  return Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : null;
}
