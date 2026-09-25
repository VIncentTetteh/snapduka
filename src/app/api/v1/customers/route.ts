import { NextResponse } from "next/server";

import { authenticateApi } from "@/lib/api-keys/auth";
import { keysetAfterFilter, nextCursorFor, parseLimit, resolveCursor } from "@/lib/api/keyset-cursor";

/**
 * GET /api/v1/customers — the API key's seller's customers, oldest first.
 *
 * Paged by keyset on (created_at, id); see src/lib/api/keyset-cursor.ts for
 * why the old `id > cursor` paging skipped and repeated rows. `nextCursor` is
 * opaque: pass it back unchanged as `?cursor=`.
 */
const COLUMNS = "id,name,email,phone,country,created_at,updated_at";

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateApi(request, "customers:read");
  if (!auth) return NextResponse.json({ error: "Unauthorized or rate limited." }, { status: 401 });
  const sellerAccountId = auth.key.seller_account_id;
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));

  const cursor = await resolveCursor(url.searchParams.get("cursor"), async (id) => {
    const { data } = await auth.admin
      .from("customers")
      .select("created_at")
      .eq("seller_account_id", sellerAccountId)
      .eq("id", id)
      .maybeSingle();
    return data?.created_at ?? null;
  });
  if (!cursor.ok) return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });

  let query = auth.admin
    .from("customers")
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
