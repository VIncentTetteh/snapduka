import { getVerificationStatus } from "@/lib/kyc/service";
import { isResponse, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * The seller's verification state and their recent checks, for the app's
 * verification screen. Polling this is also what rescues a check whose
 * vendor webhook was lost (see getVerificationStatus).
 *
 * Owner only, for the same reason as /kyc/start: masked ids and failure
 * reasons are about the owner as a person.
 */
export async function GET() {
  const actor = await requireSeller("settings.manage");
  if (isResponse(actor)) return actor;
  if (actor.role) return fail("forbidden", "Only the account owner can see identity verification.");

  try {
    const status = await getVerificationStatus({
      sellerAccountId: actor.sellerAccountId,
      country: actor.country,
    });
    return ok(status);
  } catch (error) {
    return failUnexpected("kyc.status", error);
  }
}
