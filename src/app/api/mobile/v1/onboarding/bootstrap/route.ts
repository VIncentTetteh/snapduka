import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { bootstrapSeller } from "@/lib/auth/bootstrap";
import { enforceRateLimit, isResponse, parseBody, requireAuthenticated } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Create the seller account for a freshly signed-in user.
 *
 * `bootstrap_seller_account` is service_role-only, so the device cannot call it
 * — the app's onboarding screen used to invoke the RPC directly and every
 * attempt was rejected.
 */

const schema = z.object({
  country: z.string().trim().min(1),
  contactName: z.string().trim().min(1),
  contactPhone: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const user = await requireAuthenticated();
  if (isResponse(user)) return user;

  // Keyed on the auth user, not a seller account — the caller does not have one
  // yet, and this creates real rows.
  const limited = await enforceRateLimit("onboarding.bootstrap", user.userId, {
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const actor = await resolveServerActor();
    const result = await bootstrapSeller(actor, body);

    if (result.ok) return ok({ created: true }, 201);

    switch (result.reason) {
      case "not_authenticated":
        return fail("unauthenticated", "Sign in to continue.");
      case "operator":
        return fail("forbidden", "Operator accounts cannot open a shop.");
      case "suspended":
        return fail("forbidden", "This account is suspended. Contact support.");
      case "already_exists":
        // Not an error worth blocking on: the app can simply move to the next
        // onboarding step. Reaching here usually means a retry after a timeout.
        return ok({ created: false }, 200);
      case "invalid":
        return fail("validation_failed", "Check the highlighted fields.", {
          fields: Object.fromEntries(
            Object.entries(result.fieldErrors).map(([key, messages]) => [
              key,
              messages[0] ?? "This value is not valid.",
            ]),
          ),
        });
      case "failed":
        return fail("internal", "We could not create the seller account. Please try again.");
    }
  } catch (error) {
    return failUnexpected("onboarding.bootstrap", error);
  }
}
