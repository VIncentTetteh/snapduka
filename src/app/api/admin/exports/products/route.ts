import { NextResponse } from "next/server";

import { resolveServerActor } from "@/lib/auth/actor";
import { toCsv } from "@/lib/exports/csv";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const admin = createAdminClient();

  let query = admin
    .from("products")
    .select(
      "id,name,sku,currency,price_minor,status,moderation_status,stock_quantity,reserved_quantity,seller_account_id,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(5000);

  const status = url.searchParams.get("status");
  if (status) query = query.eq("status", status);
  const moderation = url.searchParams.get("moderation");
  if (moderation) query = query.eq("moderation_status", moderation);
  const q = url.searchParams.get("q")?.trim();
  if (q) {
    const safeQuery = q.slice(0, 100).replace(/[%,()]/g, "");
    query = query.or(`name.ilike.%${safeQuery}%,sku.ilike.%${safeQuery}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Export failed." }, { status: 500 });

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
    },
  });
}
