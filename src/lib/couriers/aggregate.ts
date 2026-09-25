import "server-only";

import { createHash } from "node:crypto";

import {
  applyDeliveryMargin,
  CourierAdapterError,
  type CountryCode,
  type CourierAdapter,
  type CourierQuote,
  type CurrencyCode,
  type DeliveryAddress,
  type QuoteRequest,
} from "@snapduka/core";

import { loadCourierCredentials } from "@/lib/couriers/credentials";
import { resolveQuotingAdapters } from "@/lib/couriers/registry";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Delivery options for a shop and a destination: the seller's own delivery
 * and pickup methods, plus live quotes from every courier switched on for
 * that seller.
 *
 * Called by the storefront (POST /api/delivery/quote) and by Squad B's
 * WhatsApp agent `quote_delivery` tool. Both are buyer-facing and latency-
 * sensitive, so the rules are:
 *
 *   * The seller's own methods are ALWAYS returned. A courier outage — or no
 *     courier being enabled at all, which is the default — must never leave a
 *     buyer with nothing to choose.
 *   * Each courier gets COURIER_TIMEOUT_MS. A slow partner is dropped from this
 *     answer, not waited for: one courier must not hold the checkout hostage.
 *   * Answers are cached in courier_quotes for QUOTE_TTL_MS per (shop,
 *     destination, parcel), so a buyer toggling between options, or the agent
 *     asking twice in one conversation, does not re-fan-out.
 *   * SnapDuka's margin (country_configs.delivery_margin_bps) is added once,
 *     here, and frozen on the cached row.
 */

export const COURIER_TIMEOUT_MS = 4_000;
export const QUOTE_TTL_MS = 15 * 60 * 1000;

export type QuoteDestination = {
  line1?: string;
  area?: string;
  city: string;
  region?: string;
  digitalAddress?: string | null;
  landmark?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type QuoteDeliveryInput = {
  shopId: string;
  destination: QuoteDestination;
  /** Declared value of the goods (the cart subtotal). */
  parcelValueMinor?: number;
  weightGrams?: number | null;
  /** Cash to collect at the door, when the buyer pays on delivery. */
  codAmountMinor?: number | null;
};

export type SellerMethodOption = {
  kind: "seller_method";
  fulfillmentMethodId: string;
  type: "delivery" | "pickup";
  label: string;
  feeMinor: number;
  currency: CurrencyCode;
};

export type CourierOption = {
  kind: "courier";
  /** courier_quotes.id — what a later booking references. */
  quoteId: string;
  courierId: string;
  service: string;
  label: string;
  /** What the buyer pays: courier price + SnapDuka margin. */
  feeMinor: number;
  currency: CurrencyCode;
  etaMinutes: number | null;
  expiresAt: string;
};

export type DeliveryOption = SellerMethodOption | CourierOption;

export type CourierNote = "no_couriers_enabled" | "no_pickup_address" | "no_quotes" | null;

export type QuoteDeliveryResult =
  | {
      ok: true;
      currency: CurrencyCode;
      options: DeliveryOption[];
      /** Why no courier options appear, when none do. For logs and the agent. */
      courierNote: CourierNote;
      cached: boolean;
    }
  | { ok: false; reason: "shop_not_found" };

type ShopContext = {
  id: string;
  sellerAccountId: string;
  country: CountryCode;
  currency: CurrencyCode;
};

type QuoteRow = {
  id: string;
  provider: string;
  service: string;
  service_label: string | null;
  amount_minor: number;
  margin_minor: number;
  currency: CurrencyCode;
  eta_minutes: number | null;
  expires_at: string;
};

export async function quoteDelivery(
  input: QuoteDeliveryInput,
  options: { now?: () => Date } = {},
): Promise<QuoteDeliveryResult> {
  const now = options.now ?? (() => new Date());
  const admin = createAdminClient();

  const { data: shop } = await admin
    .from("shops")
    .select("id,seller_account_id,country,currency,status")
    .eq("id", input.shopId)
    .eq("status", "published")
    .maybeSingle();
  if (!shop) return { ok: false, reason: "shop_not_found" };
  const context: ShopContext = {
    id: shop.id,
    sellerAccountId: shop.seller_account_id,
    country: shop.country,
    currency: shop.currency,
  };

  const sellerOptions = await loadSellerMethods(context);
  const couriers = await courierOptions(context, input, now);

  return {
    ok: true,
    currency: context.currency,
    options: [...sellerOptions, ...couriers.options],
    courierNote: couriers.note,
    cached: couriers.cached,
  };
}

async function loadSellerMethods(shop: ShopContext): Promise<SellerMethodOption[]> {
  const { data, error } = await createAdminClient()
    .from("fulfillment_methods")
    .select("id,type,name,fee_minor,position")
    .eq("shop_id", shop.id)
    .eq("seller_account_id", shop.sellerAccountId)
    .eq("active", true)
    .order("position", { ascending: true })
    // A shop has a handful of methods; the bound is only so this can never be
    // the query that meets db.max_rows.
    .limit(50);
  if (error) {
    console.error("[couriers/aggregate] could not load fulfilment methods", error.message);
    return [];
  }
  return (data ?? []).map((method) => ({
    kind: "seller_method" as const,
    fulfillmentMethodId: method.id,
    type: method.type === "pickup" ? ("pickup" as const) : ("delivery" as const),
    label: method.name,
    feeMinor: Number(method.fee_minor),
    currency: shop.currency,
  }));
}

async function courierOptions(
  shop: ShopContext,
  input: QuoteDeliveryInput,
  now: () => Date,
): Promise<{ options: CourierOption[]; note: CourierNote; cached: boolean }> {
  const adapters = await resolveQuotingAdapters({
    sellerAccountId: shop.sellerAccountId,
    country: shop.country,
  });
  if (adapters.length === 0) return { options: [], note: "no_couriers_enabled", cached: false };

  const pickup = await loadPickupAddress(shop);
  if (!pickup) return { options: [], note: "no_pickup_address", cached: false };

  const dropoff = toDeliveryAddress(input.destination, shop.country);
  const key = cacheKey(shop.id, dropoff, input);
  const enabledIds = new Set(adapters.map((adapter) => adapter.id));

  const cachedRows = await readCache(key, now());
  // A courier switched off since the cache was filled must disappear now, not
  // in fifteen minutes: the flag is the kill switch.
  const usable = cachedRows.filter((row) => enabledIds.has(row.provider));
  if (usable.length > 0) {
    return { options: usable.map(rowToOption), note: null, cached: true };
  }

  const request: QuoteRequest = {
    sellerAccountId: shop.sellerAccountId,
    shopId: shop.id,
    country: shop.country,
    currency: shop.currency,
    pickup,
    dropoff,
    parcel: { valueMinor: Math.max(0, input.parcelValueMinor ?? 0), weightGrams: input.weightGrams ?? null },
    codAmountMinor: input.codAmountMinor ?? null,
  };

  const quotes = await fanOut(adapters, request);
  if (quotes.length === 0) return { options: [], note: "no_quotes", cached: false };

  const marginBps = await loadMarginBps(shop.country);
  const rows = await writeCache(shop, key, quotes, marginBps, now());
  if (rows.length === 0) return { options: [], note: "no_quotes", cached: false };
  return { options: rows.map(rowToOption), note: null, cached: false };
}

/**
 * Ask every adapter at once and keep whatever answers in time. A failure or a
 * timeout from one courier is logged and costs only that courier's options.
 */
export async function fanOut(
  adapters: CourierAdapter[],
  request: QuoteRequest,
  timeoutMs = COURIER_TIMEOUT_MS,
): Promise<CourierQuote[]> {
  const settled = await Promise.allSettled(
    adapters.map(async (adapter) => {
      // COD is a promise to collect cash; an adapter that cannot must not quote it.
      if (request.codAmountMinor && !adapter.capabilities.cod) return [];
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new CourierAdapterError(adapter.id, "timeout", `${adapter.id} took longer than ${timeoutMs}ms`));
        }, timeoutMs);
      });
      try {
        const credentials = await loadCourierCredentials(request.sellerAccountId, adapter.id);
        const quotes = await Promise.race([
          adapter.quote(request, { credentials, signal: controller.signal }),
          timeout,
        ]);
        // An adapter answering for another courier, or in another currency,
        // is a bug in the adapter; its quotes are dropped rather than shown.
        return quotes.filter(
          (quote) =>
            quote.courierId === adapter.id &&
            quote.currency === request.currency &&
            Number.isInteger(quote.amountMinor) &&
            quote.amountMinor >= 0,
        );
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  const quotes: CourierQuote[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      quotes.push(...result.value);
    } else {
      const code = result.reason instanceof CourierAdapterError ? result.reason.code : "error";
      console.warn(`[couriers/aggregate] ${adapters[index].id} quote failed (${code})`);
    }
  });
  return quotes;
}

export function toDeliveryAddress(destination: QuoteDestination, country: CountryCode): DeliveryAddress {
  const hasPin = typeof destination.lat === "number" && typeof destination.lng === "number";
  return {
    line1: destination.line1?.trim() ?? "",
    area: destination.area?.trim() ?? "",
    city: destination.city.trim(),
    region: destination.region?.trim() ?? "",
    country,
    digitalAddress: destination.digitalAddress ?? null,
    landmark: destination.landmark ?? null,
    lat: hasPin ? destination.lat : null,
    lng: hasPin ? destination.lng : null,
    geoSource: hasPin ? "device" : "none",
  };
}

/**
 * Case- and whitespace-insensitive, so "Osu " and "osu" share a cache entry.
 * Coordinates are rounded to ~100 m: two taps a metre apart are the same
 * delivery, and exact floats would make the cache useless for pins.
 */
export function cacheKey(shopId: string, dropoff: DeliveryAddress, input: QuoteDeliveryInput): string {
  const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const coord = (value: number | null | undefined) => (typeof value === "number" ? value.toFixed(3) : "");
  const parts = [
    shopId,
    norm(dropoff.line1),
    norm(dropoff.area),
    norm(dropoff.city),
    norm(dropoff.region),
    norm(dropoff.digitalAddress),
    coord(dropoff.lat),
    coord(dropoff.lng),
    String(input.parcelValueMinor ?? 0),
    String(input.weightGrams ?? ""),
    String(input.codAmountMinor ?? ""),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

async function loadPickupAddress(shop: ShopContext): Promise<DeliveryAddress | null> {
  const { data, error } = await createAdminClient()
    .from("shop_pickup_addresses")
    .select("address")
    .eq("shop_id", shop.id)
    .eq("seller_account_id", shop.sellerAccountId)
    .maybeSingle();
  if (error) {
    console.error("[couriers/aggregate] could not load the pickup address", error.message);
    return null;
  }
  const address = data?.address;
  if (!address || typeof address !== "object" || Array.isArray(address)) return null;
  const text = (key: string) => {
    const value = (address as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  };
  const number = (key: string) => {
    const value = (address as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  if (!text("city")) return null;
  return {
    line1: text("line1"),
    area: text("area"),
    city: text("city"),
    region: text("region"),
    country: shop.country,
    digitalAddress: text("digitalAddress") || null,
    landmark: text("landmark") || null,
    lat: number("lat"),
    lng: number("lng"),
    geoSource: number("lat") !== null ? "device" : "none",
  };
}

async function loadMarginBps(country: CountryCode): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("country_configs")
    .select("delivery_margin_bps")
    .eq("country", country)
    .maybeSingle();
  if (error) {
    // Pass-through is the safe failure: undercharging our margin once is
    // recoverable, and refusing to quote is not.
    console.error("[couriers/aggregate] could not read the delivery margin; using 0", error.message);
    return 0;
  }
  return data?.delivery_margin_bps ?? 0;
}

const QUOTE_COLUMNS =
  "id,provider,service,service_label,amount_minor,margin_minor,currency,eta_minutes,expires_at";

async function readCache(key: string, now: Date): Promise<QuoteRow[]> {
  const { data, error } = await createAdminClient()
    .from("courier_quotes")
    .select(QUOTE_COLUMNS)
    .eq("cache_key", key)
    .gt("expires_at", now.toISOString())
    .order("amount_minor", { ascending: true })
    .limit(50);
  if (error) {
    console.error("[couriers/aggregate] quote cache read failed", error.message);
    return [];
  }
  return (data ?? []) as QuoteRow[];
}

async function writeCache(
  shop: ShopContext,
  key: string,
  quotes: CourierQuote[],
  marginBps: number,
  now: Date,
): Promise<QuoteRow[]> {
  const ceiling = now.getTime() + QUOTE_TTL_MS;
  const rows = quotes.map((quote) => {
    const partnerExpiry = Date.parse(quote.expiresAt);
    const expiresAt = Number.isFinite(partnerExpiry) ? Math.min(partnerExpiry, ceiling) : ceiling;
    return {
      seller_account_id: shop.sellerAccountId,
      shop_id: shop.id,
      provider: quote.courierId,
      service: quote.service,
      service_label: quote.serviceLabel,
      amount_minor: quote.amountMinor,
      margin_minor: applyDeliveryMargin(quote.amountMinor, marginBps) - quote.amountMinor,
      currency: quote.currency,
      provider_quote_id: quote.providerQuoteId,
      eta_minutes: quote.etaMinutes,
      expires_at: new Date(expiresAt).toISOString(),
      cache_key: key,
    };
  });

  const { data, error } = await createAdminClient()
    .from("courier_quotes")
    .insert(rows)
    .select(QUOTE_COLUMNS);
  if (error || !data) {
    // A quote without a row has no id to book against, so it cannot be
    // offered. The seller's own methods are still returned by the caller.
    console.error("[couriers/aggregate] quote cache write failed", error?.message);
    return [];
  }
  return (data as QuoteRow[]).sort((a, b) => a.amount_minor - b.amount_minor);
}

function rowToOption(row: QuoteRow): CourierOption {
  return {
    kind: "courier",
    quoteId: row.id,
    courierId: row.provider,
    service: row.service,
    label: row.service_label ?? row.service,
    feeMinor: Number(row.amount_minor) + Number(row.margin_minor),
    currency: row.currency,
    etaMinutes: row.eta_minutes,
    expiresAt: row.expires_at,
  };
}
