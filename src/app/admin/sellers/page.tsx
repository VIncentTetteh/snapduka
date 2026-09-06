import { requireOperator } from "@/lib/auth/require-operator";
import Link from "next/link";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { InitialsAvatar } from "@/components/ui/gradient-placeholder";
import { PageHeader, Panel } from "@/components/ui/surface";
import { formatMoney } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

const SELLER_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  pending: { label: "Pending", tone: "warn" },
  restricted: { label: "Restricted", tone: "warn" },
  suspended: { label: "Suspended", tone: "danger" },
  closed: { label: "Closed", tone: "neutral" },
};

export default async function AdminSellersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // The layout redirects a non-operator; this is the handler's own check,
  // because every query below runs through the service-role client.
  await requireOperator("/admin/sellers");
  const { q } = await searchParams;
  const admin = createAdminClient();

  let query = admin
    .from("seller_accounts")
    .select("id,contact_name,contact_email,country,status,created_at,shops(display_name,slug,status)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (q?.trim()) {
    const safeQuery = q.trim().slice(0, 100).replace(/[%,()]/g, "");
    query = query.or(`contact_name.ilike.%${safeQuery}%,contact_email.ilike.%${safeQuery}%`);
  }

  // Aggregated in SQL. These two queries were platform-wide and unbounded —
  // every paid order and every risk action, summed here — so they were the
  // first in the app to cross db.max_rows and the hardest place to notice it:
  // there is no per-seller figure to check platform GMV against, so it would
  // simply have stopped growing.
  const [{ data: sellers }, { data: orderTotals }, { data: flagged }] = await Promise.all([
    query,
    admin.rpc("admin_seller_order_totals"),
    admin.rpc("admin_flagged_sellers"),
  ]);

  const gmvBySeller = (orderTotals ?? []).reduce<Record<string, { total: number; currency: string }>>(
    (acc, row) => {
      const entry = (acc[row.seller_account_id] ??= { total: 0, currency: row.currency });
      entry.total += Number(row.gmv_minor);
      return acc;
    },
    {},
  );
  const riskFlagged = new Set((flagged ?? []).map((row) => row.seller_account_id));

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <PageHeader title="Sellers" sub="Every seller account across all markets." />

      <form className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name or email…"
          aria-label="Search sellers"
          className="h-11 min-w-0 flex-1 rounded-[10px] border border-line-input bg-white px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <button
          type="submit"
          className="h-11 cursor-pointer rounded-[10px] border-none bg-ink px-4.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-ink-2"
        >
          Search
        </button>
      </form>

      {!sellers?.length ? (
        <EmptyState title="No sellers found" body="Try a different search." />
      ) : (
        <Panel className="overflow-hidden">
          {sellers.map((seller) => {
            const shop = Array.isArray(seller.shops) ? seller.shops[0] : seller.shops;
            const gmv = gmvBySeller[seller.id];
            const statusSpec = SELLER_STATUS[seller.status] ?? {
              label: seller.status,
              tone: "neutral" as BadgeTone,
            };
            const risk =
              seller.status === "suspended" || seller.status === "closed"
                ? { label: "High", tone: "danger" as BadgeTone }
                : riskFlagged.has(seller.id)
                  ? { label: "Elevated", tone: "warn" as BadgeTone }
                  : { label: "Low", tone: "success" as BadgeTone };

            return (
              <Link
                key={seller.id}
                href={`/admin/sellers/${seller.id}`}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3.5 no-underline transition-colors last:border-b-0 hover:bg-paper"
              >
                <InitialsAvatar
                  name={shop?.display_name ?? seller.contact_name ?? "?"}
                  className="h-10 w-10 text-[13px]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-ink">
                    {shop?.display_name ?? seller.contact_name}
                  </span>
                  <span className="block truncate text-[12px] text-ink-muted">
                    {seller.contact_name} · {seller.contact_email} · {seller.country}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1.5">
                  <span className="text-[13.5px] font-bold text-ink">
                    {gmv ? formatMoney(gmv.total, gmv.currency as CurrencyCode) : "—"}
                  </span>
                  <span className="flex gap-1.5">
                    <Badge tone={risk.tone}>{risk.label} risk</Badge>
                    <Badge tone={statusSpec.tone}>{statusSpec.label}</Badge>
                  </span>
                </span>
              </Link>
            );
          })}
        </Panel>
      )}
    </main>
  );
}
