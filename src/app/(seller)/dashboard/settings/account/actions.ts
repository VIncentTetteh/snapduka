"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requestAccountDeletion } from "@/lib/account/deletion";
import { resolveServerActor } from "@/lib/auth/actor";

/**
 * Closes the seller's account from the web dashboard.
 *
 * The mobile app has had this since App Store guideline 5.1.1(v) required it;
 * the web app never did, so a seller who signed up on a browser had no way to
 * leave. The work is shared with the mobile route via requestAccountDeletion,
 * so both surfaces do the same irreversible thing.
 *
 * Owner-only, and it asks the seller to type their shop slug first — this
 * unpublishes the storefront and closes the account, and a misclick should not
 * be able to do that.
 */
function back(message: string): never {
  redirect(`/dashboard/settings/account?error=${encodeURIComponent(message)}`);
}

export async function closeAccount(formData: FormData) {
  const actor = await resolveServerActor();

  // Inline redirects rather than a helper: `redirect` returns never, which is
  // what narrows `actor` to a seller for the call below.
  if (actor.kind !== "seller") back("Sign in as a seller to close an account.");
  if (actor.role) back("Only the account owner can close this account.");

  const confirmation = String(formData.get("confirm") ?? "").trim();
  const expected = String(formData.get("slug") ?? "").trim();
  if (!expected || confirmation !== expected) {
    back(`Type ${expected || "your store address"} exactly to confirm.`);
  }

  const outcome = await requestAccountDeletion({
    sellerAccountId: actor.sellerAccountId,
    userId: actor.userId,
    reason: String(formData.get("reason") ?? "").trim() || null,
  });
  if (!outcome.ok) back(outcome.message);

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/settings/account?closed=1");
}
