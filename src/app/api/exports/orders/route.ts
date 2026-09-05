import { NextResponse } from "next/server";

import { resolveServerActor } from "@/lib/auth/actor";
import { ORDER_STATUSES, oneOf } from "@/lib/db/enums";
import { getSellerPlan, planAllows, upgradeMessage } from "@/lib/billing/resolve";
import { toCsv } from "@/lib/exports/csv";
import { createRequestScopedClient } from "@/lib/supabase/request";
import { paginate } from "@/lib/supabase/paginate";

const COLUMNS = [
  "public_reference",
  "status",
  "payment_status",
  "fulfillment_status",
  "currency",
  "subtotal_minor",
  "discount_minor",
  "delivery_minor",
  "total_minor",
  "created_at",
] as const;

const HEADERS = [
  "reference",
  "status",
  "payment_status",
  "fulfillment_status",
  "currency",
  "subtotal_minor",
  "discount_minor",
  "delivery_minor",
  "total_minor",
  "created_at",
];

/**
 * A seller's orders as CSV — the file they reconcile their books against, so
 * "quietly incomplete" is the worst possible failure for it.
 *
 * It asked for `.limit(5000)` and got 1000: PostgREST caps every response at
 * db.max_rows regardless of the requested limit, and a CSV that stops early
 * looks exactly like a shop that made fewer sales. Nothing warned anyone.
 *
 * Paged by id, then sorted for output. Ordering the query by created_at would
 * need a composite cursor to be safe — timestamps are not unique — whereas the
 * id cursor is exact, and newest-first is restored in memory once every row is
 * in hand. Nothing mutates during the read, so ordering the fetch differently
 * from the output costs nothing.
 */
export async function GET(request: Request) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getSellerPlan(actor.sellerAccountId);
  if (!planAllows(plan, "exports")) {
    return NextResponse.json({ error: upgradeMessage("CSV exports") }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = oneOf(url.searchParams.get("status"), ORDER_STATUSES);
  const supabase = await createRequestScopedClient();

  const { rows, error, truncated } = await paginate(
    (cursor, size) => {
      let page = supabase
        .from("orders")
        .select(`id,${COLUMNS.join(",")}`)
        .eq("seller_account_id", actor.sellerAccountId)
        .order("id", { ascending: true })
        .limit(size);
      if (status) page = page.eq("status", status);
      if (cursor) page = page.gt("id", cursor);
      return page as unknown as PromiseLike<{
        data: ({ id: string } & Record<string, unknown>)[] | null;
        error: unknown;
      }>;
    },
    (row) => row.id,
    { pageSize: 500, maxRows: 50_000 },
  );

  if (error) return NextResponse.json({ error: "Export failed." }, { status: 500 });

  const ordered = [...rows].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );
  const csv = toCsv([HEADERS, ...ordered.map((row) => COLUMNS.map((key) => row[key]))]);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="snapduka-orders.csv"',
      // Only ever set on a shop past 50,000 orders. Stated rather than hidden:
      // silently short is the bug being fixed here.
      ...(truncated ? { "x-snapduka-truncated": "true" } : {}),
    },
  });
}
