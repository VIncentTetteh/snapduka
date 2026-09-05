import { NextResponse } from "next/server";

import { oneOf, PRODUCT_STATUSES } from "@/lib/db/enums";
import { resolveServerActor } from "@/lib/auth/actor";
import { toCsv } from "@/lib/exports/csv";
import { createAdminClient } from "@/lib/supabase/admin";
import { paginate } from "@/lib/supabase/paginate";

export async function GET(request: Request) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const admin = createAdminClient();

  const status = oneOf(url.searchParams.get("status"), PRODUCT_STATUSES);
  const moderation = url.searchParams.get("moderation");
  const q = url.searchParams.get("q")?.trim();

  // `.limit(5000)` was capped at 1000 by db.max_rows, so this file stopped a
  // fifth of the way in and looked complete — on a platform-wide catalogue
  // export an operator would reasonably treat as the full picture.
  //
  // Paged by id and sorted newest-first afterwards: a created_at cursor would
  // need a composite key to be safe, since timestamps are not unique.
  const { rows: data, error, truncated } = await paginate(
    (cursor, size) => {
      let page = admin
        .from("products")
        .select(
          "id,name,sku,currency,price_minor,status,moderation_status,stock_quantity,reserved_quantity,seller_account_id,created_at",
        )
        .order("id", { ascending: true })
        .limit(size);
      if (status) page = page.eq("status", status);
      if (moderation) page = page.eq("moderation_status", moderation);
      if (q) {
        const safeQuery = q.slice(0, 100).replace(/[%,()]/g, "");
        page = page.or(`name.ilike.%${safeQuery}%,sku.ilike.%${safeQuery}%`);
      }
      if (cursor) page = page.gt("id", cursor);
      return page;
    },
    (row) => row.id,
    { pageSize: 500, maxRows: 50_000 },
  );
  if (error) return NextResponse.json({ error: "Export failed." }, { status: 500 });

  data.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

  const headers = [
    "id",
    "name",
    "sku",
    "currency",
    "price_minor",
    "status",
    "moderation_status",
    "stock_quantity",
    "reserved_quantity",
    "seller_account_id",
    "created_at",
  ];
  const csv = toCsv([headers, ...(data ?? []).map((row) => headers.map((key) => row[key as keyof typeof row]))]);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="snapduka-products.csv"`,
      // Only past 50,000 products. Stated rather than hidden.
      ...(truncated ? { "x-snapduka-truncated": "true" } : {}),
    },
  });
}
