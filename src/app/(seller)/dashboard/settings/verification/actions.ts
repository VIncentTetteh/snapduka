"use server";

import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { appOrigin } from "@/lib/app-url";
import { isKycCheckType } from "@/lib/kyc/provider";
import { startVerification } from "@/lib/kyc/service";
import { checkRateLimit } from "@/lib/rate-limit";

const PAGE = "/dashboard/settings/verification";

function back(message: string): never {
  redirect(`${PAGE}?error=${encodeURIComponent(message)}`);
}

/**
 * Start an automated identity check (flag `kyc_auto`) and send the seller to
 * the vendor's hosted flow. Owner only: verification is about the account
 * owner as a person, and a manager verifying with their own card would verify
 * the wrong human.
 */
export async function startVerificationAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") back("Sign in as a seller to verify your shop.");
  if (actor.role) back("Only the account owner can verify their identity.");

  const type = String(formData.get("type") ?? "");
  if (!isKycCheckType(type)) back("Choose what to verify.");

  const limited = await checkRateLimit(`kyc:start:${actor.sellerAccountId}`, {
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!limited.ok) back("Too many attempts. Try again in an hour.");

  const result = await startVerification({
    sellerAccountId: actor.sellerAccountId,
    country: actor.country,
    type,
    returnUrl: `${await appOrigin()}${PAGE}`,
  });
  if (!result.ok) back(result.message);

  redirect(result.redirectUrl ?? `${PAGE}?started=1`);
}
