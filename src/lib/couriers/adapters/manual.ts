import "server-only";

import { NO_CAPABILITIES, type CourierAdapter } from "@snapduka/core";

import { unsupported } from "./shared";

/**
 * Seller-arranged delivery: today's flow, as an adapter.
 *
 * The seller books the rider themselves (a Bolt they called, their cousin on a
 * motorbike) and records what they arranged through POST /api/couriers/book.
 * There is no partner API, so this adapter can do nothing — every capability
 * is false and the booking route keeps writing the shipment itself, exactly as
 * before adapters existed.
 *
 * It exists so callers get one uniform answer. The registry returns it for any
 * courier with no integration, which means "is this courier bookable?" is
 * always `canBook(getCourierAdapter(id))` and never a special case per id.
 */
export const manualAdapter: CourierAdapter = {
  id: "manual",
  label: "Seller-arranged delivery",
  capabilities: NO_CAPABILITIES,
  countries: ["GH", "NG", "CI"],
  // "ready" rather than "not_configured": there is nothing to configure, and
  // the capability flags already say it books nothing.
  status: () => "ready",
  quote: async () => [],
  book: async () => unsupported("manual", "booking"),
  cancel: async () => unsupported("manual", "cancel"),
  track: async () => unsupported("manual", "tracking"),
  verifyWebhook: async () => false,
  parseWebhook: () => [],
};
