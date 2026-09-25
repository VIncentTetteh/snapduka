import "server-only";

import type { CountryCode, CourierAdapter } from "@snapduka/core";

import { manualAdapter } from "@/lib/couriers/adapters/manual";
import { createSandboxAdapter } from "@/lib/couriers/adapters/sandbox";
import { canBook, canQuote } from "@/lib/couriers/adapters/shared";
import { createYangoAdapter } from "@/lib/couriers/adapters/yango";
import { isFeatureEnabled } from "@/lib/flags";

/**
 * Every courier integration, keyed by courier id.
 *
 * An adapter being registered is not the same as it being usable. Three things
 * must all hold before a courier is quoted or booked through its API:
 *   1. the adapter has the capability (`quote` / `book`),
 *   2. it reports `ready` (its env vars / partner mapping are in place),
 *   3. the `courier_booking:<id>` flag is on for this seller.
 * Any courier failing those falls back to the manual, seller-arranged flow —
 * which is what every courier was before this file existed.
 */

let cache: Map<string, CourierAdapter> | null = null;

function buildRegistry(): Map<string, CourierAdapter> {
  const adapters: CourierAdapter[] = [
    manualAdapter,
    createSandboxAdapter({
      enabled: process.env.COURIER_SANDBOX_ENABLED === "true",
      webhookSecret: process.env.COURIER_SANDBOX_WEBHOOK_SECRET,
    }),
    createYangoAdapter({
      baseUrl: process.env.COURIER_YANGO_API_BASE_URL,
      apiKey: process.env.COURIER_YANGO_API_KEY,
      webhookSecret: process.env.COURIER_YANGO_WEBHOOK_SECRET,
    }),
  ];
  return new Map(adapters.map((adapter) => [adapter.id, adapter]));
}

function registry(): Map<string, CourierAdapter> {
  cache ??= buildRegistry();
  return cache;
}

/** Test seam: replace the registry, or pass null to rebuild from env. */
export function setCourierRegistryForTests(adapters: CourierAdapter[] | null): void {
  cache = adapters ? new Map(adapters.map((adapter) => [adapter.id, adapter])) : null;
}

/** The adapter for a courier id — the manual adapter for any courier without an integration. */
export function getCourierAdapter(courierId: string): CourierAdapter {
  return registry().get(courierId) ?? manualAdapter;
}

/** True when `courierId` has a real integration (not the manual fallback). */
export function isIntegratedCourier(courierId: string): boolean {
  return courierId !== manualAdapter.id && registry().has(courierId);
}

type Scope = { sellerAccountId: string; country: CountryCode };

async function flagOn(adapter: CourierAdapter, scope: Scope): Promise<boolean> {
  return isFeatureEnabled(`courier_booking:${adapter.id}`, scope);
}

/**
 * The adapter to book `courierId` through, or null when the booking must stay
 * seller-arranged. Null is the safe default for every doubt.
 */
export async function resolveBookingAdapter(
  courierId: string,
  scope: Scope,
): Promise<CourierAdapter | null> {
  if (!isIntegratedCourier(courierId)) return null;
  const adapter = getCourierAdapter(courierId);
  if (!canBook(adapter) || !adapter.countries.includes(scope.country)) return null;
  return (await flagOn(adapter, scope)) ? adapter : null;
}

/** Adapters that may be asked for a quote for this seller, flags evaluated in parallel. */
export async function resolveQuotingAdapters(scope: Scope): Promise<CourierAdapter[]> {
  const candidates = [...registry().values()].filter(
    (adapter) =>
      adapter.id !== manualAdapter.id && canQuote(adapter) && adapter.countries.includes(scope.country),
  );
  const enabled = await Promise.all(candidates.map((adapter) => flagOn(adapter, scope)));
  return candidates.filter((_, index) => enabled[index]);
}
