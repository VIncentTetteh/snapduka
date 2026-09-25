import "server-only";

import { createHash } from "node:crypto";

import {
  isShipmentStatus,
  type CourierAdapter,
  type CourierQuote,
  type NormalizedShipmentEvent,
  type QuoteRequest,
} from "@snapduka/core";

import { notConfigured, verifyHmacHeader } from "./shared";

/**
 * A deterministic fake courier for tests, local development and staging.
 *
 * Same input, same output, no network: prices are a pure function of the
 * request and booking ids a pure function of the idempotency key. That makes
 * it the reference implementation of the idempotency rule — booking the same
 * order twice returns the same booking, which is the property every real
 * adapter must have and the one the booking route relies on.
 *
 * Off unless COURIER_SANDBOX_ENABLED=true, *and* behind the
 * `courier_booking:sandbox` flag like any other courier. Both, because a fake
 * courier reachable in production would take a real buyer's delivery fee for a
 * rider who does not exist.
 */

export const SANDBOX_ID = "sandbox";
export const SANDBOX_SIGNATURE_HEADER = "x-sandbox-signature";

/** Pricing, in minor units of whatever currency the request is in. */
const BASE_MINOR = 1500;
const INTERCITY_MINOR = 1000;
const PER_EXTRA_KG_MINOR = 200;
const INCLUDED_GRAMS = 1000;
const EXPRESS_MULTIPLIER = 1.6;
const QUOTE_TTL_MS = 15 * 60 * 1000;

function sameCity(request: QuoteRequest): boolean {
  return request.pickup.city.trim().toLowerCase() === request.dropoff.city.trim().toLowerCase();
}

export function sandboxPrice(request: QuoteRequest): number {
  const grams = Math.max(0, request.parcel.weightGrams ?? 0);
  const extraKg = Math.ceil(Math.max(0, grams - INCLUDED_GRAMS) / 1000);
  return BASE_MINOR + (sameCity(request) ? 0 : INTERCITY_MINOR) + extraKg * PER_EXTRA_KG_MINOR;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type SandboxWebhookEvent = {
  id?: unknown;
  bookingId?: unknown;
  trackingNumber?: unknown;
  status?: unknown;
  occurredAt?: unknown;
  description?: unknown;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createSandboxAdapter(options: {
  enabled: boolean;
  webhookSecret?: string;
  now?: () => Date;
}): CourierAdapter {
  const now = options.now ?? (() => new Date());
  const guard = () => {
    if (!options.enabled) notConfigured(SANDBOX_ID);
  };

  return {
    id: SANDBOX_ID,
    label: "Sandbox Courier",
    capabilities: { quote: true, book: true, track: true, cod: true, webhooks: true },
    countries: ["GH", "NG", "CI"],
    status: () => (options.enabled ? "ready" : "not_configured"),

    async quote(request) {
      guard();
      const price = sandboxPrice(request);
      const expiresAt = new Date(now().getTime() + QUOTE_TTL_MS).toISOString();
      const quotes: CourierQuote[] = [
        {
          courierId: SANDBOX_ID,
          service: "standard",
          serviceLabel: "Sandbox standard",
          amountMinor: price,
          currency: request.currency,
          etaMinutes: sameCity(request) ? 240 : 1440,
          providerQuoteId: `sbxq_${digest(`standard:${price}`).slice(0, 12)}`,
          expiresAt,
        },
        {
          courierId: SANDBOX_ID,
          service: "express",
          serviceLabel: "Sandbox express",
          amountMinor: Math.ceil(price * EXPRESS_MULTIPLIER),
          currency: request.currency,
          etaMinutes: sameCity(request) ? 90 : 480,
          providerQuoteId: `sbxq_${digest(`express:${price}`).slice(0, 12)}`,
          expiresAt,
        },
      ];
      return quotes;
    },

    async book(request) {
      guard();
      const hash = digest(request.idempotencyKey);
      const trackingNumber = `SBX-${hash.slice(0, 8).toUpperCase()}`;
      return {
        providerBookingId: `sbx_${hash.slice(0, 16)}`,
        trackingNumber,
        trackingUrl: null,
        labelUrl: null,
        status: "booked",
        amountMinor: null,
      };
    },

    async cancel() {
      guard();
      return { cancelled: true };
    },

    async track(request) {
      guard();
      return {
        status: "booked",
        events: [
          {
            eventId: `${request.providerBookingId}:booked`,
            providerBookingId: request.providerBookingId,
            trackingNumber: request.trackingNumber ?? null,
            status: "booked",
            occurredAt: now().toISOString(),
            description: "Booked with the sandbox courier",
          },
        ],
      };
    },

    async verifyWebhook(request) {
      if (!options.enabled) return false;
      return verifyHmacHeader(
        options.webhookSecret,
        request.rawBody,
        request.headers[SANDBOX_SIGNATURE_HEADER],
      );
    },

    /**
     * Body: `{ "events": [{ id, bookingId, trackingNumber, status, occurredAt }] }`.
     * Events with an unknown status or no id are dropped rather than guessed at:
     * a made-up event id would defeat shipment_events deduplication.
     */
    parseWebhook(request) {
      let body: unknown;
      try {
        body = JSON.parse(request.rawBody);
      } catch {
        return [];
      }
      const raw =
        body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events)
          ? ((body as { events: SandboxWebhookEvent[] }).events)
          : [];
      const events: NormalizedShipmentEvent[] = [];
      for (const event of raw) {
        const eventId = asText(event.id);
        if (!eventId || !isShipmentStatus(event.status)) continue;
        events.push({
          eventId,
          providerBookingId: asText(event.bookingId),
          trackingNumber: asText(event.trackingNumber),
          status: event.status,
          occurredAt: asText(event.occurredAt) ?? now().toISOString(),
          description: asText(event.description),
        });
      }
      return events;
    },
  };
}
