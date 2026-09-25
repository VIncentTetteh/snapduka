import "server-only";

import type { CountryCode, Json } from "@snapduka/core";

import { isFeatureEnabled } from "@/lib/flags";
import {
  KycProviderError,
  type KycCheckType,
  type KycProvider,
  type KycResult,
} from "@/lib/kyc/provider";
import { getActiveKycProvider } from "@/lib/kyc/registry";
import { scheduleRiskAssessment } from "@/lib/risk/schedule";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Seller KYC, end to end: start a check, apply a result, report status.
 *
 * Every write goes through the definer functions in 202609250143, which own
 * the rules about what a result may do to `seller_verifications` (an operator
 * decision always wins; a verified seller is never demoted by automation).
 * This module decides only *whether* to ask: the `kyc_auto` flag, whether a
 * vendor is configured, and whether the seller's state allows a new check.
 */

export type VerificationState =
  | "not_started"
  | "in_progress"
  | "needs_action"
  | "verified"
  | "rejected"
  | "suspended";

export type StartVerificationResult =
  | { ok: true; checkId: string; redirectUrl: string | null; sdkToken: string | null }
  | {
      ok: false;
      reason: "disabled" | "not_configured" | "unsupported_type" | "already_verified" | "locked" | "provider_error";
      message: string;
    };

const LOCKED_STATES: readonly VerificationState[] = ["rejected", "suspended"];

async function currentState(sellerAccountId: string): Promise<VerificationState> {
  const { data } = await createAdminClient()
    .from("seller_verifications")
    .select("state")
    .eq("seller_account_id", sellerAccountId)
    .maybeSingle();
  return (data?.state as VerificationState | undefined) ?? "not_started";
}

export async function startVerification(input: {
  sellerAccountId: string;
  country: CountryCode;
  type: KycCheckType;
  returnUrl: string;
  provider?: KycProvider;
}): Promise<StartVerificationResult> {
  const enabled = await isFeatureEnabled("kyc_auto", {
    sellerAccountId: input.sellerAccountId,
    country: input.country,
  });
  if (!enabled) {
    return { ok: false, reason: "disabled", message: "Automatic verification is not available for your shop yet." };
  }
  const provider = input.provider ?? getActiveKycProvider();
  if (provider.status() !== "ready") {
    return { ok: false, reason: "not_configured", message: "Automatic verification is not available yet." };
  }
  if (!provider.supportedTypes.includes(input.type)) {
    return { ok: false, reason: "unsupported_type", message: "That kind of check is not available." };
  }

  const state = await currentState(input.sellerAccountId);
  // A business registration check is still useful to an identity-verified
  // seller (it unlocks higher limits later); a second identity check is not.
  if (state === "verified" && input.type !== "business_reg") {
    return { ok: false, reason: "already_verified", message: "Your identity is already verified." };
  }
  if (LOCKED_STATES.includes(state)) {
    return {
      ok: false,
      reason: "locked",
      message: "Verification for this account is under review. Contact support.",
    };
  }

  let started;
  try {
    started = await provider.startCheck(
      { sellerAccountId: input.sellerAccountId, country: input.country, returnUrl: input.returnUrl },
      input.type,
    );
  } catch (error) {
    const code = error instanceof KycProviderError ? error.code : "unavailable";
    console.error(`[kyc] ${provider.id} could not start a ${input.type} check (${code})`);
    return { ok: false, reason: "provider_error", message: "Verification could not be started. Try again shortly." };
  }

  const { data: checkId, error } = await createAdminClient().rpc("start_kyc_check", {
    p_seller_account_id: input.sellerAccountId,
    p_provider: provider.id,
    p_check_type: input.type,
    p_provider_ref: started.providerRef,
    p_expires_at: started.expiresAt ?? undefined,
  });
  if (error || !checkId) {
    console.error("[kyc] could not record the check", error?.message);
    return { ok: false, reason: "provider_error", message: "Verification could not be started. Try again shortly." };
  }
  return { ok: true, checkId, redirectUrl: started.redirectUrl, sdkToken: started.sdkToken };
}

export type AppliedKycResult =
  | {
      applied: true;
      checkId: string;
      sellerAccountId: string;
      status: string;
      verificationState: VerificationState | null;
    }
  | { applied: false; reason: string };

function readApplied(value: Json | null): AppliedKycResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { applied: false, reason: "no_result" };
  if (value.applied !== true) {
    return { applied: false, reason: typeof value.reason === "string" ? value.reason : "not_applied" };
  }
  return {
    applied: true,
    checkId: String(value.checkId),
    sellerAccountId: String(value.sellerAccountId),
    status: String(value.status),
    verificationState: typeof value.verificationState === "string" ? (value.verificationState as VerificationState) : null,
  };
}

/** Apply one normalised result. Idempotent (the SQL function no-ops a replay). */
export async function applyKycResult(providerId: string, result: KycResult): Promise<AppliedKycResult> {
  const { data, error } = await createAdminClient().rpc("apply_kyc_result", {
    p_provider: providerId,
    p_provider_ref: result.providerRef,
    p_status: result.status,
    p_match_score: result.matchScore ?? undefined,
    p_masked_id: result.maskedId ?? undefined,
    p_failure_reason: result.failureReason ?? undefined,
    p_result: { ...result.details },
  });
  if (error) {
    // Thrown, not swallowed: the webhook turns this into a 5xx so the vendor
    // retries, instead of a lost verification.
    throw new Error(`apply_kyc_result failed: ${error.message}`);
  }
  const applied = readApplied(data);
  if (applied.applied) {
    // Observe-only (src/lib/risk): a mismatch or repeated failures become a
    // risk signal for operators; the verification outcome above is unchanged.
    scheduleRiskAssessment("kyc_result", (risk) =>
      risk.assessKycRisk({
        sellerAccountId: applied.sellerAccountId,
        checkId: applied.checkId,
        status: applied.status,
        matchScore: result.matchScore,
      }),
    );
  }
  return applied;
}

export type KycCheckSummary = {
  id: string;
  checkType: string;
  status: string;
  maskedId: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type VerificationStatus = {
  state: VerificationState;
  automatic: "available" | "disabled" | "not_configured";
  supportedTypes: readonly KycCheckType[];
  checks: KycCheckSummary[];
};

/** How long a pending check waits for its webhook before we ask the vendor directly. */
const POLL_AFTER_MS = 2 * 60 * 1000;
const MAX_POLLS = 3;

export async function getVerificationStatus(input: {
  sellerAccountId: string;
  country: CountryCode;
  now?: Date;
}): Promise<VerificationStatus> {
  const admin = createAdminClient();
  const provider = getActiveKycProvider();
  const enabled = await isFeatureEnabled("kyc_auto", {
    sellerAccountId: input.sellerAccountId,
    country: input.country,
  });

  const { data: rows } = await admin
    .from("kyc_checks")
    .select("id,provider,provider_ref,check_type,status,masked_id,failure_reason,created_at,completed_at")
    .eq("seller_account_id", input.sellerAccountId)
    .order("created_at", { ascending: false })
    .limit(5);
  const checks = rows ?? [];

  // Lost-webhook fallback, bounded: only the few most recent, only once they
  // are old enough that the webhook should have arrived.
  const now = (input.now ?? new Date()).getTime();
  const stale = checks
    .filter(
      (check) =>
        check.status === "pending" &&
        check.provider === provider.id &&
        now - Date.parse(check.created_at) > POLL_AFTER_MS,
    )
    .slice(0, MAX_POLLS);
  let polled = false;
  for (const check of stale) {
    try {
      const result = await provider.getResult(check.provider_ref);
      if (result.status !== "pending") {
        const applied = await applyKycResult(provider.id, result);
        polled ||= applied.applied;
      }
    } catch (error) {
      console.warn(`[kyc] polling ${check.id} failed`, error instanceof Error ? error.message : error);
    }
  }

  const refreshed = polled
    ? ((
        await admin
          .from("kyc_checks")
          .select("id,provider,provider_ref,check_type,status,masked_id,failure_reason,created_at,completed_at")
          .eq("seller_account_id", input.sellerAccountId)
          .order("created_at", { ascending: false })
          .limit(5)
      ).data ?? checks)
    : checks;

  return {
    state: await currentState(input.sellerAccountId),
    automatic: !enabled ? "disabled" : provider.status() === "ready" ? "available" : "not_configured",
    supportedTypes: provider.supportedTypes,
    checks: refreshed.map((check) => ({
      id: check.id,
      checkType: check.check_type,
      status: check.status,
      maskedId: check.masked_id,
      failureReason: check.failure_reason,
      createdAt: check.created_at,
      completedAt: check.completed_at,
    })),
  };
}
