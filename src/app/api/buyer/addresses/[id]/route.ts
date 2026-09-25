import { z } from "zod";

import { ADDRESS_COLUMNS, buyerAddressInputSchema, toAddressColumns } from "@/lib/buyer/addresses";
import { requireBuyer } from "@/lib/buyer/guard";
import { isResponse, parseBody } from "@/lib/mobile/guard";
import { fail, failUnexpected, ok } from "@/lib/mobile/response";

/**
 * Edit or remove one saved address. RLS (buyer_addresses_owner_all) makes
 * another buyer's id match zero rows, which is reported as 404 — the same
 * answer as an id that never existed, so ids cannot be probed.
 */

const idSchema = z.uuid();

async function addressId(params: Promise<{ id: string }>): Promise<string | Response> {
  const parsed = idSchema.safeParse((await params).id);
  return parsed.success ? parsed.data : fail("not_found", "Address not found.");
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireBuyer();
  if (isResponse(session)) return session;
  const id = await addressId(params);
  if (isResponse(id)) return id;

  const body = await parseBody(request, buyerAddressInputSchema);
  if (isResponse(body)) return body;

  const { data, error } = await session.client
    .from("buyer_addresses")
    .update(toAddressColumns(body))
    .eq("id", id)
    .eq("buyer_profile_id", session.buyer.buyerProfileId)
    .select(ADDRESS_COLUMNS)
    .maybeSingle();
  if (error) return failUnexpected("buyer.addresses.update", error);
  if (!data) return fail("not_found", "Address not found.");
  return ok({ address: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireBuyer();
  if (isResponse(session)) return session;
  const id = await addressId(params);
  if (isResponse(id)) return id;

  const { data, error } = await session.client
    .from("buyer_addresses")
    .delete()
    .eq("id", id)
    .eq("buyer_profile_id", session.buyer.buyerProfileId)
    .select("id");
  if (error) return failUnexpected("buyer.addresses.delete", error);
  if (!data || data.length === 0) return fail("not_found", "Address not found.");
  return ok({ deleted: true });
}
