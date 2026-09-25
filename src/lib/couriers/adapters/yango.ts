import "server-only";

import type { CourierAdapter } from "@snapduka/core";

import { createHttpTransport, type HttpTransport } from "./http";
import { notConfigured, verifyHmacHeader } from "./shared";

/**
 * Yango Delivery — skeleton, awaiting partner API access.
 *
 * Yango is the first real partner we are pursuing for Ghana (on-demand
 * motorbike and car delivery in Accra and Kumasi). We do not have API access
 * or documentation under contract yet, so this adapter is deliberately inert:
 *
 *   * `status()` is `not_configured` until BOTH the env vars below are set AND
 *     `MAPPING_VERIFIED` is flipped in code after the request/response mapping
 *     has been written and tested against the partner's sandbox. Env vars alone
 *     must not switch on an integration whose payloads are guesses.
 *   * every method throws `not_configured` until then.
 *
 * Required env vars (see .env.example):
 *   COURIER_YANGO_API_BASE_URL   partner API base URL (sandbox or production)
 *   COURIER_YANGO_API_KEY        platform API key — SnapDuka's own account, used
 *                                when a seller has no courier_connections row
 *   COURIER_YANGO_WEBHOOK_SECRET HMAC secret for status webhooks
 *
 * A seller who brings their own Yango business account supplies `{ "apiKey" }`
 * through courier_connections (Vault); that key overrides the platform one.
 *
 * To finish this adapter: implement quote/book/cancel/track against
 * `transport()`, add recorded-fixture tests in yango.test.ts, confirm the
 * webhook signature header name, then set MAPPING_VERIFIED = true.
 */

export const YANGO_ID = "yango";
const MAPPING_VERIFIED = false;
/** Placeholder until the partner confirms their signature header. */
const SIGNATURE_HEADER = "x-yango-signature";

export type YangoEnv = {
  baseUrl?: string;
  apiKey?: string;
  webhookSecret?: string;
};

export function createYangoAdapter(env: YangoEnv, fetchImpl?: typeof fetch): CourierAdapter {
  const configured = Boolean(MAPPING_VERIFIED && env.baseUrl && env.apiKey);

  // Built lazily so a missing env var never throws at import time.
  function transport(credentials: Readonly<Record<string, string>> | null): HttpTransport {
    const apiKey = credentials?.apiKey ?? env.apiKey;
    if (!configured || !env.baseUrl || !apiKey) notConfigured(YANGO_ID);
    return createHttpTransport({
      courierId: YANGO_ID,
      baseUrl: env.baseUrl,
      apiKey,
      idempotencyHeader: "idempotency-key",
      fetchImpl,
    });
  }

  return {
    id: YANGO_ID,
    label: "Yango Delivery",
    capabilities: { quote: true, book: true, track: true, cod: false, webhooks: true },
    countries: ["GH", "CI"],
    status: () => (configured ? "ready" : "not_configured"),
    async quote(_request, context) {
      transport(context.credentials);
      return notConfigured(YANGO_ID);
    },
    async book(_request, context) {
      transport(context.credentials);
      return notConfigured(YANGO_ID);
    },
    async cancel(_request, context) {
      transport(context.credentials);
      return notConfigured(YANGO_ID);
    },
    async track(_request, context) {
      transport(context.credentials);
      return notConfigured(YANGO_ID);
    },
    async verifyWebhook(request) {
      if (!configured) return false;
      return verifyHmacHeader(env.webhookSecret, request.rawBody, request.headers[SIGNATURE_HEADER]);
    },
    parseWebhook: () => [],
  };
}
