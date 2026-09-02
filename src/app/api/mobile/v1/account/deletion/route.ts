import { z } from "zod";

import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";
import { requestAccountDeletion } from "@/lib/account/deletion";

/**
 * Start deleting a seller account, from inside the app.
 *
 * App Store guideline 5.1.1(v) requires this path to exist for any app that
 * lets someone create an account. There was none.
 *
 * The work itself lives in @/lib/account/deletion so the web settings action
 * does exactly the same thing; this route is the transport plus the owner check
 * and the rate limit.
 *
 * Only the account owner may do this: a team member closing the shop they work
 * for would be an obvious way to cause damage.
 */

const schema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request) {
  const actor = await requireSeller("settings.manage");
  if (isResponse(actor)) return actor;

  if (actor.role) {
    return fail("forbidden", "Only the account owner can close this account.");
  }

  const limited = await enforceRateLimit("account.deletion", actor.sellerAccountId, {
    limit: 3,
    windowMs: 24 * 60 * 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const outcome = await requestAccountDeletion({
      sellerAccountId: actor.sellerAccountId,
      userId: actor.userId,
      reason: body.reason ?? null,
    });
    if (!outcome.ok) return failUnexpected("account.deletion", new Error(outcome.message));
    return ok(
      { requested: true, requestedAt: outcome.requestedAt },
      outcome.alreadyRequested ? 200 : 201,
    );
  } catch (error) {
    return failUnexpected("account.deletion", error);
  }
}
