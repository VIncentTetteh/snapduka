import type { CountryCode, CurrencyCode, FlagKey } from "@snapduka/core";

import { getActiveBnplProvider } from "@/lib/bnpl/registry";
import { paystackProvider } from "@/lib/payments/paystack";
import type { PaymentProvider } from "@/lib/payments/types";

/**
 * Every payment provider SnapDuka can route a checkout to, and what each can
 * do. Adding a provider is one entry here plus its adapter; the router, health
 * record and per-provider flag (`provider:<id>`) need no change.
 */
export type ProviderId = "paystack" | "hubtel" | "bnpl";

/**
 * What the buyer chose at checkout. Card/MoMo providers compete in one route
 * with failover between them; "bnpl" is a different promise to the buyer (pay
 * in instalments), so it is only ever routed when the buyer picked it and is
 * never a silent fallback for a failed card payment, or the other way round.
 */
export type PaymentMethodKind = "card_momo" | "bnpl";

export type ProviderEntry = {
  id: ProviderId;
  countries: readonly CountryCode[];
  currencies: readonly CurrencyCode[];
  /** Credentials present. An unconfigured provider is never offered. */
  configured: () => boolean;
  method: PaymentMethodKind;
  /** Paystack is the incumbent and needs no flag; new providers ship dark. */
  requiresFlag: boolean;
  /** The flag checked when requiresFlag; defaults to `provider:<id>`. */
  flagKey?: FlagKey;
  adapter: () => PaymentProvider;
};

class NotConfiguredProvider implements PaymentProvider {
  constructor(private readonly id: string) {}
  private fail(): never {
    throw new Error(`${this.id} is not configured`);
  }
  initialize(): never {
    return this.fail();
  }
  verify(): never {
    return this.fail();
  }
  refund(): never {
    return this.fail();
  }
}

export const PROVIDERS: readonly ProviderEntry[] = [
  {
    id: "paystack",
    countries: ["GH", "NG"],
    currencies: ["GHS", "NGN"],
    configured: () => Boolean(process.env.PAYSTACK_SECRET_KEY),
    method: "card_momo",
    requiresFlag: false,
    adapter: paystackProvider,
  },
  {
    // Direct MoMo collection for Ghana. Awaiting a merchant agreement and API
    // credentials (HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET / HUBTEL_MERCHANT_ACCOUNT);
    // until then it reports unconfigured and is never routed to.
    id: "hubtel",
    countries: ["GH"],
    currencies: ["GHS"],
    configured: () =>
      Boolean(process.env.HUBTEL_CLIENT_ID && process.env.HUBTEL_CLIENT_SECRET && process.env.HUBTEL_MERCHANT_ACCOUNT),
    method: "card_momo",
    requiresFlag: true,
    adapter: () => new NotConfiguredProvider("hubtel"),
  },
  {
    // Buy now, pay later (ADR-0014). The partner pays SnapDuka the full order
    // total, so a BNPL approval is an ordinary capture. Which partner is
    // BNPL_PROVIDER (src/lib/bnpl/registry.ts); none is contracted, so this
    // reports unconfigured outside the sandbox. Gated by the `bnpl` flag.
    id: "bnpl",
    countries: ["GH", "NG"],
    currencies: ["GHS", "NGN"],
    configured: () => getActiveBnplProvider().status() === "ready",
    method: "bnpl",
    requiresFlag: true,
    flagKey: "bnpl",
    adapter: getActiveBnplProvider,
  },
];
