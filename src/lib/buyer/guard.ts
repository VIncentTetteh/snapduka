import "server-only";

import type { BuyerActor } from "@/lib/auth/actor";
import { fail } from "@/lib/mobile/response";

import type { BuyerClient } from "./account";
import { getBuyerSession } from "./session";

/**
 * Route guard for /api/buyer/*. Works for the web (cookies) and the mobile app
 * (Bearer JWT) alike, because the session resolves through the request-scoped
 * client. Responds with the same error envelope as /api/mobile/v1 so the app
 * can reuse its handling.
 *
 * While the flag is off every buyer route answers 404, not 403: an unreleased
 * feature should be indistinguishable from one that does not exist.
 */
export async function requireBuyer(): Promise<{ buyer: BuyerActor; client: BuyerClient } | Response> {
  const session = await getBuyerSession({ claimOnResolve: false });
  switch (session.state) {
    case "buyer":
      return { buyer: session.buyer, client: session.client };
    case "disabled":
      return fail("not_found", "Not found.");
    case "anonymous":
    case "needs_phone":
      return fail("unauthenticated", "Sign in with your phone number.");
    case "phone_in_use":
      return fail("conflict", "This phone number is already linked to another SnapDuka profile.");
    case "error":
      return fail("internal", "Something went wrong. Please try again.");
  }
}
