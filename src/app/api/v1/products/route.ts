import { NextResponse } from "next/server";

import { authenticateApi } from "@/lib/api-keys/auth";
import { keysetAfterFilter, nextCursorFor, parseLimit, resolveCursor } from "@/lib/api/keyset-cursor";

/**
 * GET /api/v1/products — the API key's seller's products, oldest first. `created_at` was added (additive) because it is the sort key the cursor encodes.
 *
 * Paged by keyset on (created_at, id); see src/lib/api/keyset-cursor.ts for
 * why the old `id > cursor` paging skipped and repeated rows. `nextCursor` is
 * opaque: pass it back unchanged as `?cursor=`.
 */
const COLUMNS = "id,name,slug,description,currency,price_minor,status,inventory_policy,stock_quantity,created_at,updated_at";

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateApi(request, "products:read");
  if (!auth) return NextResponse.json({ error: "Unauthorized or rate limited." }, { status: 401 });
  const sellerAccountId = auth.key.seller_account_id;
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));

  const cursor = await resolveCursor(url.searchParams.get("cursor"), async (id) => {
    const { data } = await auth.admin
      .from("products")
      .select("created_at")
      .eq("seller_account_id", sellerAccountId)
      .eq("id", id)
      .maybeSingle();
    return data?.created_at ?? null;
  });
  if (!cursor.ok) return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });

  let query = auth.admin
    .from("products")
    .select(COLUMNS)
    .eq("seller_account_id", sellerAccountId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (cursor.position) query = query.or(keysetAfterFilter(cursor.position));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Query failed." }, { status: 500 });
  return NextResponse.json({ data, nextCursor: nextCursorFor(data, limit) });
}
