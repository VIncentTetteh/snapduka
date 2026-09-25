import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@snapduka/core";
import { z } from "zod";

/**
 * Typed wrappers over the buyer RPCs (202609250170).
 *
 * Every function takes the caller's OWN request-scoped client, never the admin
 * client: the RPCs resolve the buyer from auth.uid(), so running them with the
 * service role would resolve nobody — and would be one refactor away from
 * resolving the wrong person.
 */
export type BuyerClient = SupabaseClient<Database>;

const bootstrapSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    created: z.boolean(),
    profileId: z.string(),
    phone: z.string(),
    consented: z.boolean(),
  }),
  z.object({ status: z.literal("phone_unverified") }),
  z.object({ status: z.literal("phone_in_use") }),
]);
export type BootstrapResult = z.infer<typeof bootstrapSchema> | { status: "error" };

export async function bootstrapBuyerProfile(client: BuyerClient): Promise<BootstrapResult> {
  const { data, error } = await client.rpc("bootstrap_buyer_profile");
  const parsed = bootstrapSchema.safeParse(data);
  if (error || !parsed.success) {
    console.error("[buyer] bootstrap failed", error?.message ?? "unexpected shape");
    return { status: "error" };
  }
  return parsed.data;
}

const claimSchema = z.object({
  status: z.enum(["ok", "no_profile", "consent_required"]),
  claimed: z.number().int().nonnegative(),
});
export type ClaimResult = z.infer<typeof claimSchema> | { status: "error"; claimed: 0 };

export async function claimGuestOrders(client: BuyerClient): Promise<ClaimResult> {
  const { data, error } = await client.rpc("claim_guest_orders");
  const parsed = claimSchema.safeParse(data);
  if (error || !parsed.success) {
    console.error("[buyer] claim failed", error?.message ?? "unexpected shape");
    return { status: "error", claimed: 0 };
  }
  return parsed.data;
}

const consentSchema = z.object({
  status: z.enum(["ok", "no_profile"]),
  ordersUnlinked: z.number().int().nonnegative().optional(),
});

export async function setSharedProfileConsent(
  client: BuyerClient,
  granted: boolean,
  version: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("set_buyer_shared_profile_consent", {
    p_granted: granted,
    p_version: granted ? version : undefined,
  });
  const parsed = consentSchema.safeParse(data);
  if (error || !parsed.success || parsed.data.status !== "ok") {
    console.error("[buyer] consent update failed", error?.message ?? "unexpected shape");
    return false;
  }
  return true;
}

export type BuyerOrderRow = Database["public"]["Functions"]["buyer_order_history"]["Returns"][number];

export const ORDER_PAGE_SIZE = 20;

/**
 * One keyset page of the buyer's cross-shop history, newest first. Paged by
 * created_at (never offset) so a claim landing mid-scroll cannot shift rows
 * under the reader, and bounded server-side at 50 regardless of what is asked.
 */
export async function listBuyerOrders(
  client: BuyerClient,
  before?: string | null,
): Promise<{ rows: BuyerOrderRow[]; nextBefore: string | null } | null> {
  const { data, error } = await client.rpc("buyer_order_history", {
    p_before: before ?? undefined,
    p_limit: ORDER_PAGE_SIZE,
  });
  if (error || !data) {
    console.error("[buyer] order history failed", error?.message);
    return null;
  }
  const nextBefore = data.length === ORDER_PAGE_SIZE ? data[data.length - 1].created_at : null;
  return { rows: data, nextBefore };
}

export async function exportBuyerData(client: BuyerClient): Promise<Record<string, unknown> | null> {
  const { data, error } = await client.rpc("export_buyer_data");
  if (error || data === null || typeof data !== "object" || Array.isArray(data)) {
    if (error) console.error("[buyer] export failed", error.message);
    return null;
  }
  return data;
}

export async function requestBuyerDeletion(client: BuyerClient, reason: string | null): Promise<boolean> {
  const { data, error } = await client.rpc("request_buyer_deletion", {
    p_reason: reason?.slice(0, 500) || undefined,
  });
  const parsed = z.object({ status: z.literal("ok") }).safeParse(data);
  if (error || !parsed.success) {
    console.error("[buyer] deletion failed", error?.message ?? "unexpected shape");
    return false;
  }
  return true;
}
