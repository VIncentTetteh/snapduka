import { flagSnapshot } from "@/lib/flags";
import { broadcastChannels } from "@/lib/marketing/channels";
import { enforceRateLimit, isResponse, requireActiveSeller } from "@/lib/mobile/guard";
import { failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Who the app is signed in as, and which features are switched on for them.
 *
 * Flags ride on this call rather than their own so the app learns them in the
 * same round trip it already makes, and caches them with the account (the
 * mobile query cache persists this across cold starts, so a flag-gated screen
 * does not flicker in and out offline).
 *
 * Contract: additive only. Older builds ignore `flags`; newer builds treat a
 * missing flag as off, which is also what the server does when a flag cannot
 * be read — @/lib/flags fails closed.
 */
export async function GET() {
  const actor = await requireActiveSeller();
  if (isResponse(actor)) return actor;

  // Each snapshot is one evaluation per flag key; the app asks on focus, not
  // in a loop, so this ceiling only bites a misbehaving client.
  const limited = await enforceRateLimit("account.read", actor.sellerAccountId, {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const [flags, channels] = await Promise.all([
      flagSnapshot(actor.sellerAccountId),
      broadcastChannels(actor.sellerAccountId),
    ]);
    const response = ok({
      account: {
        sellerAccountId: actor.sellerAccountId,
        userId: actor.userId,
        country: actor.country,
        status: actor.status,
        // The owner has no team_memberships row; say so rather than omit it.
        role: actor.role ?? "owner",
      },
      flags,
      // Which broadcast channels can deliver right now; the app offers only
      // these (it writes broadcasts directly, so it cannot ask at save time).
      broadcastChannels: channels,
    });
    // Per-seller and changes when an operator flips a flag: never cache it in
    // a shared layer.
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return failUnexpected("account.read", error);
  }
}
