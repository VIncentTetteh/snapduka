import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { toCsv } from "@/lib/exports/csv";
import { buildStatement, STATEMENT_HEADERS, type StatementEntry } from "@/lib/payouts/statement";
import { paginate } from "@/lib/supabase/paginate";
import { createRequestScopedClient } from "@/lib/supabase/request";

/**
 * Wallet statement CSV for a period. Reads through the seller's own RLS
 * (ledger_entries is readable by its owner), paged by id so the 1000-row
 * PostgREST cap cannot silently shorten a document someone will lend against.
 */
const query = z.object({
  currency: z.enum(["GHS", "NGN", "XOF"]),
  from: z.iso.date(),
  to: z.iso.date(),
});

export async function GET(request: Request) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const parsed = query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Choose a currency and a date range." }, { status: 400 });
  const { currency, from, to } = parsed.data;
  if (from > to) return NextResponse.json({ error: "The start date is after the end date." }, { status: 400 });
  // Inclusive of the whole end day.
  const until = new Date(`${to}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 1);

  const supabase = await createRequestScopedClient();
  const { rows, error, truncated } = await paginate(
    (cursor, size) => {
      let page = supabase
        .from("ledger_entries")
        .select(
          "id,created_at,amount_minor,balance_after_minor,account:ledger_accounts(kind),transaction:ledger_transactions(kind,reason,orders(public_reference))",
        )
        .eq("seller_account_id", actor.sellerAccountId)
        .eq("currency", currency)
        .gte("created_at", `${from}T00:00:00Z`)
        .lt("created_at", until.toISOString())
        .order("id", { ascending: true })
        .limit(size);
      if (cursor) page = page.gt("id", cursor);
      return page as unknown as PromiseLike<{ data: StatementEntry[] | null; error: unknown }>;
    },
    (row) => row.id,
    { pageSize: 500, maxRows: 100_000 },
  );
  if (error) return NextResponse.json({ error: "Statement failed." }, { status: 500 });

  const { rows: body, summary } = buildStatement(rows);
  const preamble: (string | number)[][] = [
    ["SnapDuka wallet statement", "", "", "", "", "", ""],
    ["currency", currency, "from", from, "to", to, ""],
    ...summary.map((s) => ["account", s.account, "opening_minor", s.openingMinor, "closing_minor", s.closingMinor, ""]),
    [],
  ];
  const csv = toCsv([...preamble, STATEMENT_HEADERS, ...body]);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="snapduka-statement-${currency}-${from}-${to}.csv"`,
      ...(truncated ? { "x-snapduka-truncated": "true" } : {}),
    },
  });
}
