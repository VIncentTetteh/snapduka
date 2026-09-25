import "server-only";

import { notConfiguredBnplProvider, type BnplProvider } from "@/lib/bnpl/provider";
import { createSandboxBnplProvider } from "@/lib/bnpl/sandbox";

/**
 * Which BNPL partner this deployment uses: BNPL_PROVIDER names it. Webhooks
 * are resolved by the id in their URL, so outcomes for checkouts started under
 * a previous partner still land after a switch.
 *
 * Adding a partner: implement BnplProvider in <partner>.ts, register it in
 * build(), document its env vars in .env.example.
 */

let cache: Map<string, BnplProvider> | null = null;

function build(): Map<string, BnplProvider> {
  const providers: BnplProvider[] = [
    createSandboxBnplProvider({
      enabled: process.env.BNPL_SANDBOX_ENABLED === "true",
      webhookSecret: process.env.BNPL_SANDBOX_WEBHOOK_SECRET,
    }),
  ];
  return new Map(providers.map((provider) => [provider.id, provider]));
}

function providers(): Map<string, BnplProvider> {
  cache ??= build();
  return cache;
}

/** Test seam. */
export function setBnplProvidersForTests(list: BnplProvider[] | null): void {
  cache = list ? new Map(list.map((provider) => [provider.id, provider])) : null;
}

/** The partner new checkouts use; not_configured until one is contracted. */
export function getActiveBnplProvider(): BnplProvider {
  const chosen = providers().get(process.env.BNPL_PROVIDER ?? "");
  return chosen && chosen.status() === "ready" ? chosen : notConfiguredBnplProvider;
}

/** The partner a webhook URL names, or null. */
export function getBnplProviderById(id: string): BnplProvider | null {
  return providers().get(id) ?? null;
}
