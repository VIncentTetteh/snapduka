import { z } from "zod";

import { inviteCreator } from "@/lib/creators/invite";
import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Invite a creator from the app.
 *
 * The invitation link is a bearer credential binding a commission rate to
 * whoever holds it: only its SHA-256 hash is stored, and the plaintext exists
 * only long enough to be emailed or texted. Neither the hashing nor the
 * delivery can happen on a device, which is why this is a route rather than a
 * direct insert — and why the row is rolled back if delivery fails, so a
 * phantom invitation cannot silently occupy a plan seat forever.
 */

const schema = z.object({
  contact: z.string().trim().min(3).max(200),
  /** Whole percent, e.g. 7.5. Bounded server-side against MAX_RATE_BPS. */
  ratePercent: z.number().positive(),
  holdDays: z.number().int().min(0).max(90).default(14),
});

export async function POST(request: Request) {
  const actor = await requireSeller("campaigns.manage");
  if (isResponse(actor)) return actor;

  const limited = await enforceRateLimit("creators.invite", actor.sellerAccountId, {
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const result = await inviteCreator(
      { sellerAccountId: actor.sellerAccountId, userId: actor.userId },
      body,
    );

    if (result.ok) return ok({ invited: true }, 201);

    switch (result.reason) {
      case "plan":
      case "seat_limit":
        return fail("plan_limit", result.message);
      case "invalid":
        return fail("validation_failed", result.message, {
          fields: { [result.field]: result.message },
        });
      case "failed":
        return fail("internal", result.message);
    }
  } catch (error) {
    return failUnexpected("creators.invite", error);
  }
}
