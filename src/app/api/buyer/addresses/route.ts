import { z } from "zod";

import { ADDRESS_COLUMNS, buyerAddressInputSchema, MAX_SAVED_ADDRESSES, toAddressColumns } from "@/lib/buyer/addresses";
import { requireBuyer } from "@/lib/buyer/guard";
import { enforceRateLimit, isResponse, parseBody } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * The signed-in buyer's address book. Reads and writes go through the buyer's
 * own client, so buyer_addresses_owner_all (RLS) is the boundary: the profile
 * id is taken from the session, never from the body.
 */

const createSchema = z.intersection(
  buyerAddressInputSchema,
  z.object({ makeDefault: z.boolean().optional() }),
);

export async function GET() {
  const session = await requireBuyer();
  if (isResponse(session)) return session;

  const { data, error } = await session.client
    .from("buyer_addresses")
    .select(ADDRESS_COLUMNS)
    .eq("buyer_profile_id", session.buyer.buyerProfileId)
    .order("created_at", { ascending: false })
    .limit(MAX_SAVED_ADDRESSES);
  if (error) return failUnexpected("buyer.addresses.list", error);
  return ok({ addresses: data ?? [] });
}

export async function POST(request: Request) {
  const session = await requireBuyer();
  if (isResponse(session)) return session;

  const limited = await enforceRateLimit("buyer.addresses.create", session.buyer.buyerProfileId, {
    limit: 30,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;

  const body = await parseBody(request, createSchema);
  if (isResponse(body)) return body;

  const { data, error } = await session.client
    .from("buyer_addresses")
    .insert({ ...toAddressColumns(body), buyer_profile_id: session.buyer.buyerProfileId })
    .select(ADDRESS_COLUMNS)
    .single();
  if (error?.code === "54000") {
    return fail("conflict", `You can save up to ${MAX_SAVED_ADDRESSES} addresses. Remove one first.`);
  }
  if (error || !data) return failUnexpected("buyer.addresses.create", error);

  if (body.makeDefault) {
    const { error: defaultError } = await session.client
      .from("buyer_profiles")
      .update({ default_address_id: data.id })
      .eq("id", session.buyer.buyerProfileId);
    // The address is saved either way; failing to star it is not worth a 500.
    if (defaultError) console.error("[buyer] could not set default address", defaultError.message);
  }

  return ok({ address: data }, 201);
}
