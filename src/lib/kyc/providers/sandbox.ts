import "server-only";

import { randomUUID } from "node:crypto";

import { verifyHmacHeader } from "@/lib/couriers/adapters/shared";
import {
  KycProviderError,
  maskIdNumber,
  sanitizeKycDetails,
  type KycProvider,
  type KycResult,
  type KycStatus,
} from "@/lib/kyc/provider";

/**
 * A fake KYC vendor for local development, staging and tests.
 *
 * Nothing is captured: startCheck hands back a reference and sends the seller
 * straight back to the return URL. The outcome then arrives one of two ways,
 * mirroring a real vendor:
 *   * a signed webhook to /api/kyc/webhook/sandbox (HMAC-SHA256 of the raw body
 *     in `x-kyc-sandbox-signature`, secret KYC_SANDBOX_WEBHOOK_SECRET) — this is
 *     how tests and QA script a pass or a failure;
 *   * polling via getResult, which answers KYC_SANDBOX_AUTO_RESULT
 *     (passed | failed; anything else stays pending) — for a staging demo with
 *     no webhook tooling.
 *
 * Off unless KYC_SANDBOX_ENABLED=true, because a sandbox that says "passed"
 * reachable in production would verify anyone.
 */

export const KYC_SANDBOX_ID = "sandbox";
export const KYC_SANDBOX_SIGNATURE_HEADER = "x-kyc-sandbox-signature";

const RESUMABLE_MS = 60 * 60 * 1000;
const STATUSES: readonly KycStatus[] = ["pending", "passed", "failed", "needs_review", "expired", "error"];

function asStatus(value: unknown): KycStatus | null {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
    ? (value as KycStatus)
    : null;
}

export function createSandboxKycProvider(options: {
  enabled: boolean;
  webhookSecret?: string;
  autoResult?: string;
  now?: () => Date;
}): KycProvider {
  const now = options.now ?? (() => new Date());
  const guard = () => {
    if (!options.enabled) throw new KycProviderError("not_configured", "The KYC sandbox is off.");
  };

  function outcome(providerRef: string, status: KycStatus): KycResult {
    return {
      providerRef,
      status,
      matchScore: status === "passed" ? 95 : status === "failed" ? 20 : null,
      maskedId: status === "passed" ? maskIdNumber("GHA-000000000-0") : null,
      failureReason: status === "failed" ? "Sandbox: document did not match" : null,
      details: { sandbox: true },
    };
  }

  return {
    id: KYC_SANDBOX_ID,
    supportedTypes: ["ghana_card", "liveness", "business_reg"],
    status: () => (options.enabled ? "ready" : "not_configured"),

    async startCheck(seller) {
      guard();
      const providerRef = `sbxkyc_${randomUUID()}`;
      const url = new URL(seller.returnUrl);
      url.searchParams.set("kyc_ref", providerRef);
      return {
        providerRef,
        redirectUrl: url.toString(),
        sdkToken: `sandbox:${providerRef}`,
        expiresAt: new Date(now().getTime() + RESUMABLE_MS).toISOString(),
      };
    },

    async getResult(providerRef) {
      guard();
      const auto = asStatus(options.autoResult);
      return outcome(providerRef, auto === "passed" || auto === "failed" ? auto : "pending");
    },

    async verifyWebhook(request) {
      if (!options.enabled) return false;
      return verifyHmacHeader(
        options.webhookSecret,
        request.rawBody,
        request.headers[KYC_SANDBOX_SIGNATURE_HEADER],
      );
    },

    /**
     * Body: `{ "results": [{ ref, status, matchScore?, idNumber?, reason?, jobId? }] }`.
     * `idNumber` is accepted only to prove the masking path: it is masked here
     * and the clear value goes no further.
     */
    parseWebhook(request) {
      let body: unknown;
      try {
        body = JSON.parse(request.rawBody);
      } catch {
        return [];
      }
      const raw =
        body && typeof body === "object" && Array.isArray((body as { results?: unknown }).results)
          ? (body as { results: Record<string, unknown>[] }).results
          : [];
      const results: KycResult[] = [];
      for (const item of raw) {
        const status = asStatus(item.status);
        if (typeof item.ref !== "string" || !item.ref || !status) continue;
        const score = typeof item.matchScore === "number" ? Math.max(0, Math.min(100, item.matchScore)) : null;
        results.push({
          providerRef: item.ref,
          status,
          matchScore: score,
          maskedId: typeof item.idNumber === "string" && item.idNumber ? maskIdNumber(item.idNumber) : null,
          failureReason: typeof item.reason === "string" ? item.reason.slice(0, 200) : null,
          details: sanitizeKycDetails({ jobId: item.jobId, sandbox: true }),
        });
      }
      return results;
    },
  };
}
