import { z } from "zod";

import { API_KEY_SCOPES, issueApiKey } from "@/lib/api-keys/issue";
import { enforceRateLimit, isResponse, parseBody, requireSeller } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Issue an API key from the app.
 *
 * The plaintext token is in this response and nowhere else, ever — only a
 * peppered hash is stored, and the pepper is server-only, which is why the key
 * cannot be minted on the device.
 *
 * The app previously sent the seller to the web dashboard for this, where they
 * arrived with no session (mobile keeps its session in SecureStore, never as a
 * browser cookie) and hit a login wall. The reasoning for keeping it off-device
 * was about handing a secret to a phone clipboard, but the web flow does the
 * same thing — shows it once and asks you to copy it — so the effect was only
 * that app-only sellers could not create a key at all.
 */

const schema = z.object({
  name: z.string().trim().max(80).nullish(),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
});

export async function POST(request: Request) {
  const actor = await requireSeller("settings.manage");
  if (isResponse(actor)) return actor;
  // `settings.manage` is held by managers too, but the web action is
  // owner-only — the owner is the seller with no role of their own. Minting a
  // credential that can read orders and customers is not something to widen by
  // accident.
  if (actor.role) return fail("forbidden", "Only the account owner can create API keys.");

  const limited = await enforceRateLimit("developers.apiKeys", actor.sellerAccountId, {
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, schema);
  if (isResponse(body)) return body;

  try {
    const result = await issueApiKey(actor, { name: body.name, scopes: body.scopes });
    if (result.ok) return ok({ token: result.token }, 201);

    switch (result.reason) {
      case "plan_limit":
        return fail("plan_limit", result.message);
      case "invalid":
        return fail("validation_failed", result.message, { fields: { scopes: result.message } });
      case "config":
      case "failed":
        return fail("internal", result.message);
    }
  } catch (error) {
    return failUnexpected("developers.apiKeys", error);
  }
}
