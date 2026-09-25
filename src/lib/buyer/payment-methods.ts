import "server-only";

import type { Database } from "@snapduka/core";

import type { createAdminClient } from "@/lib/supabase/admin";

import { isBuyerTokenSealingConfigured, sealBuyerToken } from "./crypto";

type AdminClient = ReturnType<typeof createAdminClient>;

export type MomoNetwork = "mtn" | "telecel" | "airteltigo";

export type SavePaymentMethodInput =
  | {
      buyerProfileId: string;
      method: "momo";
      network: MomoNetwork;
      /** E.164 wallet number; only its masked form is stored in the clear. */
      msisdn: string;
      /** Paystack reusable authorization_code. */
      authorizationCode: string;
    }
  | {
      buyerProfileId: string;
      method: "card";
      last4: string | null;
      authorizationCode: string;
    };

/**
 * "+233241234567" -> "024****567": enough for the buyer to recognise their own
 * wallet, useless to anyone reading over their shoulder. Non-Ghana numbers keep
 * their calling code, since there is no national-format convention to fall back on.
 */
export function maskMsisdn(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const national = digits.startsWith("233") ? `0${digits.slice(3)}` : digits;
  if (national.length < 7) return "*".repeat(Math.max(national.length, 6));
  return `${national.slice(0, 3)}${"*".repeat(national.length - 6)}${national.slice(-3)}`;
}

/**
 * Stores a reusable payment authorisation for one-tap checkout.
 *
 * Service role only: buyer_payment_methods grants clients no insert, because
 * the only trustworthy source of an authorization_code is Paystack's verified
 * charge response on our server — never the browser.
 *
 * NOT YET CALLED: the Paystack charge flow that would produce a reusable
 * authorization is out of this squad's scope (payment code is frozen) and has
 * no test credentials. This is the landing point for it.
 */
export async function saveBuyerPaymentMethod(
  admin: AdminClient,
  input: SavePaymentMethodInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: "not_configured" | "failed" }> {
  if (!isBuyerTokenSealingConfigured()) return { ok: false, reason: "not_configured" };

  const row: Database["public"]["Tables"]["buyer_payment_methods"]["Insert"] =
    input.method === "momo"
      ? {
          buyer_profile_id: input.buyerProfileId,
          provider: "paystack",
          method: "momo",
          momo_network: input.network,
          msisdn_masked: maskMsisdn(input.msisdn),
          card_last4: null,
          provider_token_sealed: sealBuyerToken(input.authorizationCode),
        }
      : {
          buyer_profile_id: input.buyerProfileId,
          provider: "paystack",
          method: "card",
          momo_network: null,
          msisdn_masked: null,
          card_last4: input.last4 && /^\d{4}$/.test(input.last4) ? input.last4 : null,
          provider_token_sealed: sealBuyerToken(input.authorizationCode),
        };

  const { data, error } = await admin.from("buyer_payment_methods").insert(row).select("id").single();
  if (error || !data) {
    console.error("[buyer.payment-methods] could not save", error?.message);
    return { ok: false, reason: "failed" };
  }
  return { ok: true, id: data.id };
}
