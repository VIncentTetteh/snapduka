import { z } from "zod";

import { KYC_CHECK_TYPES } from "@/lib/kyc/provider";
import { startVerification } from "@/lib/kyc/service";
import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Start an automated identity check from the app (flag `kyc_auto`).
 *
 * Returns either a hosted-flow URL to open or a token for the vendor's SDK;
 * the vendor captures the Ghana Card and selfie on its own surface, so no ID
 * image ever passes through the app or this server.
 *
 * Owner only. `settings.manage` alone would admit a manager, and identity
 * verification is about the account owner as a person — a manager verifying
 * with their own card would verify the wrong human.
 */

const schema = z.object({ type: z.enum(KYC_CHECK_TYPES) });

/** Where a vendor's hosted flow sends the seller back to: the app itself. */
const APP_RETURN_URL = "snapduka://settings/verification";

const FAILURE_CODE = {
  disabled: "forbidden",
  not_configured: "forbidden",
  unsupported_type: "validation_failed",
  already_verified: "conflict",
  locked: "forbidden",
  provider_error: "internal",
} as const;

export async function POST(request: Request) {
  const actor = await requireSeller("settings.manage");
  if (isResponse(actor)) return actor;
  if (actor.role) return fail("forbidden", "Only the account owner can verify their identity.");

  // Each start can cost a vendor call; a few retries an hour is plenty.
  const limited = await enforceRateLimit("kyc.start", actor.sellerAccountId, {
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const result = await startVerification({
      sellerAccountId: actor.sellerAccountId,
      country: actor.country,
      type: body.type,
      returnUrl: APP_RETURN_URL,
    });
    if (!result.ok) return fail(FAILURE_CODE[result.reason], result.message);
    return ok(
      { checkId: result.checkId, redirectUrl: result.redirectUrl, sdkToken: result.sdkToken },
      201,
    );
  } catch (error) {
    return failUnexpected("kyc.start", error);
  }
}
