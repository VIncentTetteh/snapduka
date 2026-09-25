import "server-only";

import type { KycProvider } from "@/lib/kyc/provider";
import { notConfiguredKycProvider } from "@/lib/kyc/providers/not-configured";
import { createSandboxKycProvider } from "@/lib/kyc/providers/sandbox";

/**
 * Which KYC vendor this deployment uses: KYC_PROVIDER names it. Only one is
 * active for *starting* checks at a time, but webhooks are resolved by the id
 * in the URL, so results for checks started under a previous provider still
 * land after a switch.
 *
 * Adding a vendor: implement KycProvider in providers/<vendor>.ts, register it
 * in `build()`, document its env vars in .env.example.
 */

let cache: Map<string, KycProvider> | null = null;

function build(): Map<string, KycProvider> {
  const providers: KycProvider[] = [
    createSandboxKycProvider({
      enabled: process.env.KYC_SANDBOX_ENABLED === "true",
      webhookSecret: process.env.KYC_SANDBOX_WEBHOOK_SECRET,
      autoResult: process.env.KYC_SANDBOX_AUTO_RESULT,
    }),
  ];
  return new Map(providers.map((provider) => [provider.id, provider]));
}

function providers(): Map<string, KycProvider> {
  cache ??= build();
  return cache;
}

/** Test seam. */
export function setKycProvidersForTests(list: KycProvider[] | null): void {
  cache = list ? new Map(list.map((provider) => [provider.id, provider])) : null;
}

/** The provider new checks start with; `not_configured` until a vendor is chosen. */
export function getActiveKycProvider(): KycProvider {
  const chosen = providers().get(process.env.KYC_PROVIDER ?? "");
  return chosen && chosen.status() === "ready" ? chosen : notConfiguredKycProvider;
}

/** The provider a webhook URL names, or null. */
export function getKycProviderById(id: string): KycProvider | null {
  return providers().get(id) ?? null;
}
