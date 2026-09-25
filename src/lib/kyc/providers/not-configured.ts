import "server-only";

import { KycProviderError, type KycProvider } from "@/lib/kyc/provider";

/**
 * The default until a vendor is contracted: reports `not_configured`, starts
 * nothing, and verifies no webhook. With this in place the seller UI shows
 * "automatic verification is coming" and the operator's manual approval in
 * /admin stays the only path to verified — exactly today's behaviour.
 */
export const notConfiguredKycProvider: KycProvider = {
  id: "not_configured",
  supportedTypes: [],
  status: () => "not_configured",
  startCheck: async () => {
    throw new KycProviderError("not_configured", "Automatic verification is not available yet.");
  },
  getResult: async () => {
    throw new KycProviderError("not_configured", "Automatic verification is not available yet.");
  },
  verifyWebhook: async () => false,
  parseWebhook: () => [],
};
