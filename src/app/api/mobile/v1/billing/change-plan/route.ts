import { z } from "zod";

import { planChange } from "@/lib/billing/change-plan";
import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Change the seller's plan from the app.
 *
 * The app used to open the web billing page in a browser to do this, where the
 * seller arrived with no session — mobile keeps its session in SecureStore,
 * never as a browser cookie — and hit a login wall. The paid conversion path
 * was a dead end.
 *
 * This returns Paystack's `authorizationUrl` instead, and the app opens that
 * directly. Paystack's checkout page needs no SnapDuka session, so there is
 * nothing to log into. Downgrades and cancellations need no checkout at all and
 * come back as `scheduled`.
 *
 * The rules themselves are shared with the web action via @/lib/billing/change-plan.
 */

const schema = z.object({
  planCode: z.enum(["free", "growth", "scale"]),
  interval: z.enum(["monthly", "yearly"]).nullish(),
});

export async function POST(request: Request) {
  // Owner-only, matching the web action's "actor has no role of their own".
  const actor = await requireSeller("billing.manage");
  if (isResponse(actor)) return actor;

  // A plan change can create a Paystack plan and a subscription row, so it is
  // not something to allow in a tight loop.
  const limited = await enforceRateLimit("billing.changePlan", actor.sellerAccountId, {
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const outcome = await planChange(actor, {
      planCode: body.planCode,
      interval: body.interval ?? null,
    });

    if (!outcome.ok) return fail("validation_failed", outcome.message);

    return outcome.kind === "checkout"
      ? ok({ kind: "checkout", authorizationUrl: outcome.authorizationUrl })
      : ok({ kind: "scheduled", message: outcome.message });
  } catch (error) {
    return failUnexpected("billing.changePlan", error);
  }
}
