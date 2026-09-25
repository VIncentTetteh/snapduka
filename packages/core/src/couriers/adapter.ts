import type { DeliveryAddress } from "../addresses/types";
import type { CountryCode, CurrencyCode } from "../countries/types";

/**
 * The contract every courier integration implements (roadmap: cross-squad
 * contract `CourierAdapter`).
 *
 * It lives in core, not next to the adapters, because three callers depend on
 * its types without depending on any adapter: the quote aggregator, Squad B's
 * WhatsApp `quote_delivery` tool, and the Expo app rendering quote options. An
 * adapter is server-only (it holds credentials); its shapes are not.
 *
 * Deliberately narrow. Every method takes plain data and returns plain data,
 * and anything a partner's API does that does not fit here (insurance,
 * multi-drop, proof-of-delivery photos) stays inside that adapter until a
 * second partner needs it too. Designing the contract around one partner's
 * feature list is how every other partner ends up faking half of it.
 */

/** What an adapter can actually do. The aggregator and booking route check these, never the id. */
export type CourierCapabilities = {
  quote: boolean;
  book: boolean;
  track: boolean;
  /** Collects cash on delivery and remits it. */
  cod: boolean;
  /** Pushes status changes to /api/couriers/webhook/[provider]. */
  webhooks: boolean;
};

/**
 * `not_configured` is a normal state, not an error: an adapter whose partner
 * has not given us API access (or whose env vars are missing in this
 * environment) reports it and is skipped. It must never throw at import time.
 */
export type CourierAdapterStatus = "ready" | "not_configured";

/** The shipment states SnapDuka understands, matching `shipments_status_check`. */
export const SHIPMENT_STATUSES = ["booked", "in_transit", "delivered", "cancelled", "failed"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export function isShipmentStatus(value: unknown): value is ShipmentStatus {
  return typeof value === "string" && (SHIPMENT_STATUSES as readonly string[]).includes(value);
}

export type ParcelDetails = {
  /** Declared value of the goods, for insurance and COD limits. */
  valueMinor: number;
  weightGrams?: number | null;
  description?: string | null;
};

export type ContactDetails = { name: string; phoneE164: string };

export type QuoteRequest = {
  sellerAccountId: string;
  shopId: string;
  country: CountryCode;
  currency: CurrencyCode;
  pickup: DeliveryAddress;
  dropoff: DeliveryAddress;
  parcel: ParcelDetails;
  /** Present when the buyer pays the rider; adapters without `cod` must not quote it. */
  codAmountMinor?: number | null;
};

export type CourierQuote = {
  courierId: string;
  /** Partner service code, e.g. "express" / "same_day". Opaque to SnapDuka. */
  service: string;
  serviceLabel: string;
  /** What the courier charges us, before SnapDuka's delivery margin. */
  amountMinor: number;
  currency: CurrencyCode;
  etaMinutes: number | null;
  /** Some partners require the quote id at booking to honour the price. */
  providerQuoteId: string | null;
  /** ISO timestamp; never later than the partner's own expiry. */
  expiresAt: string;
};

export type BookRequest = {
  /**
   * The order id. Partners that support idempotency keys receive it verbatim;
   * for those that do not, the adapter must look up an existing booking by
   * reference before creating one. A seller double-tapping "Book" must never
   * send two riders.
   */
  idempotencyKey: string;
  orderId: string;
  /** Buyer-facing order reference, printed on the label. */
  reference: string;
  sellerAccountId: string;
  country: CountryCode;
  currency: CurrencyCode;
  service?: string | null;
  providerQuoteId?: string | null;
  pickup: DeliveryAddress;
  dropoff: DeliveryAddress;
  sender: ContactDetails;
  recipient: ContactDetails;
  parcel: ParcelDetails;
  codAmountMinor?: number | null;
};

export type BookResult = {
  providerBookingId: string;
  trackingNumber: string;
  trackingUrl: string | null;
  labelUrl: string | null;
  status: ShipmentStatus;
  /** The price the partner actually charged, when it tells us. */
  amountMinor: number | null;
};

export type CancelRequest = { providerBookingId: string; reason?: string | null };
export type CancelResult = { cancelled: boolean };

export type TrackRequest = { providerBookingId: string; trackingNumber?: string | null };

/**
 * One status change, whatever the partner called it. `eventId` is what
 * shipment_events dedupes on, so it must be stable across a partner's retries:
 * use the partner's own event id where it has one, never a timestamp we made up.
 */
export type NormalizedShipmentEvent = {
  eventId: string;
  providerBookingId: string | null;
  trackingNumber: string | null;
  status: ShipmentStatus;
  occurredAt: string;
  description: string | null;
};

export type TrackResult = { status: ShipmentStatus; events: NormalizedShipmentEvent[] };

/**
 * A webhook as received: the raw body (signatures are over bytes, and a
 * re-serialised JSON body will not verify) and lower-cased headers.
 */
export type CourierWebhookRequest = {
  rawBody: string;
  headers: Readonly<Record<string, string>>;
};

/**
 * Per-call context. Credentials are resolved by the caller (platform env, or a
 * seller's own `courier_connections` row via Vault) so an adapter never reads
 * the database or the environment for secrets during a call — which is what
 * makes the sandbox and the contract tests possible.
 */
export type CourierCallContext = {
  credentials: Readonly<Record<string, string>> | null;
  signal?: AbortSignal;
};

export type CourierAdapterErrorCode =
  | "not_configured"
  | "unsupported"
  | "rejected"
  | "unavailable"
  | "timeout";

/**
 * The only error an adapter throws on purpose. `rejected` means the partner
 * said no to this request (address out of zone, parcel too heavy) and retrying
 * will not help; `unavailable`/`timeout` mean it might.
 */
export class CourierAdapterError extends Error {
  readonly code: CourierAdapterErrorCode;
  readonly courierId: string;

  constructor(courierId: string, code: CourierAdapterErrorCode, message: string) {
    super(message);
    this.name = "CourierAdapterError";
    this.code = code;
    this.courierId = courierId;
  }

  get retryable(): boolean {
    return this.code === "unavailable" || this.code === "timeout";
  }
}

export interface CourierAdapter {
  /** Matches the courier catalogue key (`yango`, `manual`, ...) or `sandbox`. */
  readonly id: string;
  readonly label: string;
  readonly capabilities: CourierCapabilities;
  /** Countries the partner operates in. The aggregator skips the rest. */
  readonly countries: readonly CountryCode[];
  status(): CourierAdapterStatus;
  quote(request: QuoteRequest, context: CourierCallContext): Promise<CourierQuote[]>;
  book(request: BookRequest, context: CourierCallContext): Promise<BookResult>;
  cancel(request: CancelRequest, context: CourierCallContext): Promise<CancelResult>;
  track(request: TrackRequest, context: CourierCallContext): Promise<TrackResult>;
  /** Constant-time; false on any doubt. Never throws. */
  verifyWebhook(request: CourierWebhookRequest): Promise<boolean>;
  /** Only called after verifyWebhook passed. May return several events, or none. */
  parseWebhook(request: CourierWebhookRequest): NormalizedShipmentEvent[];
}

/** No capabilities at all: the starting point for adapters that override what they support. */
export const NO_CAPABILITIES: CourierCapabilities = {
  quote: false,
  book: false,
  track: false,
  cod: false,
  webhooks: false,
};

/**
 * A quote as the buyer sees it: the courier's price plus SnapDuka's delivery
 * margin, rounded up to a whole minor unit. Up, because rounding down on every
 * delivery is a guaranteed small loss on each one.
 */
export function applyDeliveryMargin(amountMinor: number, marginBps: number): number {
  if (!Number.isFinite(amountMinor) || amountMinor < 0) {
    throw new RangeError("amountMinor must be a non-negative number");
  }
  const bps = Math.max(0, Math.floor(marginBps));
  return amountMinor + Math.ceil((amountMinor * bps) / 10_000);
}
