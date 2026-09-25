import { NextResponse } from "next/server";

import { resolveBuyerActor } from "@/lib/auth/actor";
import { ADDRESS_COLUMNS, toDeliveryAddress } from "@/lib/buyer/addresses";
import { isBuyerAccountsEnabled } from "@/lib/buyer/session";
import { createRequestScopedClient } from "@/lib/supabase/request";

/**
 * What the storefront checkout form may prefill for the signed-in buyer.
 *
 * Fetched by the form after it mounts rather than read by the checkout page,
 * so the storefront page stays cacheable and a guest's checkout renders
 * exactly as before. Always 200: a guest, a flag that is off, and a lookup
 * failure all answer `{ signedIn: false }` — checkout must never block on this.
 *
 * Read-only on purpose (no bootstrap, no claim): this runs on every checkout
 * page view, and a GET that writes is how caches and prefetchers surprise you.
 */
const NO_STORE = { "Cache-Control": "private, no-store" };
const PREFILL_ADDRESS_LIMIT = 5;

/** `available` lets checkout offer a sign-in link only once the feature is live. */
function signedOut(available = false) {
  return NextResponse.json(available ? { signedIn: false, available: true } : { signedIn: false }, { headers: NO_STORE });
}

export async function GET() {
  try {
    if (!(await isBuyerAccountsEnabled())) return signedOut();

    const actor = await resolveBuyerActor();
    if (actor.kind !== "buyer") return signedOut(true);

    const client = await createRequestScopedClient();
    const [{ data: profile }, { data: addresses }] = await Promise.all([
      client.from("buyer_profiles").select("display_name,default_address_id").eq("id", actor.buyerProfileId).maybeSingle(),
      client
        .from("buyer_addresses")
        .select(ADDRESS_COLUMNS)
        .eq("buyer_profile_id", actor.buyerProfileId)
        .order("created_at", { ascending: false })
        .limit(PREFILL_ADDRESS_LIMIT),
    ]);

    return NextResponse.json(
      {
        signedIn: true,
        name: profile?.display_name ?? null,
        phone: actor.phone,
        defaultAddressId: profile?.default_address_id ?? null,
        addresses: (addresses ?? []).map((row) => ({ id: row.id, label: row.label, ...toDeliveryAddress(row) })),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[buyer] checkout prefill failed", error instanceof Error ? error.message : error);
    return signedOut();
  }
}
