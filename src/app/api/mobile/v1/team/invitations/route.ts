import { z } from "zod";

import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";
import { inviteTeamMember } from "@/lib/team/invite";

/**
 * Invite a teammate from the app.
 *
 * The invitation link is a bearer credential: only its SHA-256 hash is stored,
 * and the plaintext exists only long enough to be emailed. Neither the hashing
 * nor the delivery can happen on a device, which is why this is a route rather
 * than a direct insert.
 *
 * Before it existed the app sent the seller to the web dashboard, where they
 * arrived without a session — mobile keeps its session in SecureStore and never
 * as a browser cookie — and hit a login wall.
 */

const schema = z.object({
  email: z.string().trim().min(3).max(200),
  role: z.string().trim().min(1).max(40),
});

export async function POST(request: Request) {
  // Inviting staff is an owner-level action; `team.manage` is what the web
  // action's `actor.role` check enforces.
  const actor = await requireSeller("team.manage");
  if (isResponse(actor)) return actor;

  const limited = await enforceRateLimit("team.invite", actor.sellerAccountId, {
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const result = await inviteTeamMember(
      { sellerAccountId: actor.sellerAccountId, userId: actor.userId },
      body,
    );

    if (result.ok) return ok({ invited: true }, 201);

    switch (result.reason) {
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
    return failUnexpected("team.invite", error);
  }
}
