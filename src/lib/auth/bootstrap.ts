import { parseAccountSetup } from "@/lib/auth/onboarding";
import { createAdminClient } from "@/lib/supabase/admin";

import type { Actor } from "./actor";

/**
 * Creating a seller account for an authenticated user who does not have one.
 *
 * `bootstrap_seller_account` is revoked from `authenticated` and granted only
 * to `service_role` (202606120003_onboarding.sql), so this cannot run on the
 * device — the Expo app calls the mobile API route, which calls this, exactly
 * as the onboarding wizard's server action does.
 */

export type BootstrapFailure =
  | { reason: "not_authenticated" }
  | { reason: "operator" }
  | { reason: "suspended" }
  | { reason: "already_exists" }
  | { reason: "invalid"; fieldErrors: Record<string, string[]> }
  | { reason: "failed" };

export type BootstrapResult = { ok: true } | ({ ok: false } & BootstrapFailure);

export type BootstrapInput = {
  country: string;
  contactName: string;
  contactPhone: string;
};

/**
 * Whether this actor is allowed to bootstrap, and why not if they are not.
 * Separated so callers can report the distinction — "you already have an
 * account" and "your account is suspended" need different responses.
 */
export function checkBootstrapActor(actor: Actor): BootstrapFailure | null {
  if (actor.kind === "anonymous") return { reason: "not_authenticated" };
  if (actor.kind === "operator") return { reason: "operator" };
  if (actor.kind === "seller") {
    return actor.status === "suspended" ? { reason: "suspended" } : { reason: "already_exists" };
  }
  return null;
}

export async function bootstrapSeller(
  actor: Actor,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const rejection = checkBootstrapActor(actor);
  if (rejection) return { ok: false, ...rejection };
  if (!("userId" in actor)) return { ok: false, reason: "not_authenticated" };

  const parsed = parseAccountSetup(
    {
      country: input.country,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
    },
    actor.email,
  );

  if (!parsed.success) {
    return { ok: false, reason: "invalid", fieldErrors: parsed.fieldErrors };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("bootstrap_seller_account", {
    p_auth_user_id: actor.userId,
    p_country: parsed.data.country,
    p_contact_name: parsed.data.contactName,
    p_contact_phone: parsed.data.contactPhone,
  });

  if (error) return { ok: false, reason: "failed" };
  return { ok: true };
}
