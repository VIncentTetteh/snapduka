import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  CourierAdapterError,
  type CourierAdapter,
  type CourierCapabilities,
} from "@snapduka/core";

/**
 * Helpers every adapter needs and none should reimplement: constant-time
 * signature checks and the "this method is not supported" answer.
 */

/** hex HMAC-SHA256 of the raw body. */
export function hmacSha256Hex(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Constant-time string comparison that tolerates unequal lengths (which
 * `timingSafeEqual` throws on). The length check leaks only the length of the
 * expected signature, which is public — it is a hex digest.
 */
export function safeEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verify `sha256=<hex>` or bare `<hex>` in `header` against the body. */
export function verifyHmacHeader(
  secret: string | undefined,
  rawBody: string,
  header: string | undefined,
): boolean {
  if (!secret || !header) return false;
  const received = header.startsWith("sha256=") ? header.slice("sha256=".length) : header;
  return safeEqual(hmacSha256Hex(secret, rawBody), received.trim().toLowerCase());
}

export function unsupported(id: string, method: string): never {
  throw new CourierAdapterError(id, "unsupported", `${id} does not support ${method}.`);
}

export function notConfigured(id: string): never {
  throw new CourierAdapterError(id, "not_configured", `${id} is not configured in this environment.`);
}

/** True only for an adapter that can take a booking right now. */
export function canBook(adapter: CourierAdapter): boolean {
  return adapter.capabilities.book && adapter.status() === "ready";
}

export function canQuote(adapter: CourierAdapter): boolean {
  return adapter.capabilities.quote && adapter.status() === "ready";
}

export type { CourierCapabilities };
