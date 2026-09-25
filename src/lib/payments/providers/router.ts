import type { CountryCode, CurrencyCode } from "@snapduka/core";

import { isFeatureEnabled } from "@/lib/flags";
import { createAdminClient } from "@/lib/supabase/admin";

import { PROVIDERS, type PaymentMethodKind, type ProviderEntry, type ProviderId } from "./registry";

export type Route = { provider: ProviderEntry; reason: string };

/**
 * Candidate providers for a checkout, best first: those that serve the country
 * and currency, have credentials, are flagged on for the seller (new providers
 * only), and whose circuit is closed. Registry order is the preference order.
 *
 * The caller tries the first and may fall back to the next ONLY if
 * initialisation failed — never after the buyer has been sent to authorise.
 *
 * Only providers of the buyer's chosen `method` are candidates (default
 * card/MoMo), so a BNPL partner is never a fallback for a card payment.
 */
export async function routeCheckout(input: {
  country: CountryCode;
  currency: CurrencyCode;
  sellerAccountId: string;
  method?: PaymentMethodKind;
}): Promise<Route[]> {
  const admin = createAdminClient();
  const routes: Route[] = [];
  const method = input.method ?? "card_momo";
  for (const provider of PROVIDERS) {
    if (provider.method !== method) continue;
    if (!provider.countries.includes(input.country) || !provider.currencies.includes(input.currency)) continue;
    if (!provider.configured()) continue;
    if (
      provider.requiresFlag &&
      !(await isFeatureEnabled(provider.flagKey ?? `provider:${provider.id}`, {
        sellerAccountId: input.sellerAccountId,
      }))
    ) {
      continue;
    }
    const { data: available, error } = await admin.rpc("provider_available", {
      p_provider: provider.id,
      p_country: input.country,
    });
    // A health lookup failure must not take checkout down: treat as available.
    if (error) console.error(`[payments/router] health check failed for ${provider.id}`, error);
    if (available === false) continue;
    routes.push({ provider, reason: routes.length === 0 ? "preferred" : "fallback" });
  }
  return routes;
}

/** Feed the circuit breaker. Best-effort: never fails the caller. */
export async function recordPaymentOutcome(
  provider: ProviderId,
  country: CountryCode,
  success: boolean,
): Promise<void> {
  const { error } = await createAdminClient().rpc("record_payment_outcome", {
    p_provider: provider,
    p_country: country,
    p_success: success,
  });
  if (error) console.error(`[payments/router] could not record outcome for ${provider}`, error);
}
