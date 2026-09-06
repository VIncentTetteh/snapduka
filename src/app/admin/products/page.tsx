import { requireOperator } from "@/lib/auth/require-operator";
import { ActionBanner } from "@/components/ui/action-banner";
import { createCategoryAction, setCategoryActiveAction } from "@/app/admin/products/actions";
import { ProductListWithBulkActions, type AdminProductRow } from "@/components/admin/product-bulk-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPills } from "@/components/ui/filter-pills";
import { MetricTile } from "@/components/ui/metric-tile";
import { PageHeader, Panel } from "@/components/ui/surface";
import { SubmitButton } from "@/components/ui/submit-button";
import { mainImageUrl } from "@/lib/storefront/media";
import { formatMoney } from "@/lib/i18n";
import { oneOf, PRODUCT_STATUSES } from "@/lib/db/enums";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = [
  { label: "All statuses", value: "" },
  { label: "Draft", value: "draft" },
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
];

const MODERATION_FILTERS = [
  { label: "All", value: "" },
  { label: "Flagged", value: "flagged" },
  { label: "Hidden", value: "hidden" },
];

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function resolveMatchingSellerIds(admin: ReturnType<typeof createAdminClient>, term: string) {
  const [{ data: byContact }, { data: byShop }] = await Promise.all([
    admin.from("seller_accounts").select("id").ilike("contact_name", `%${term}%`).limit(50),
    admin.from("shops").select("seller_account_id").ilike("display_name", `%${term}%`).limit(50),
  ]);
  const ids = new Set<string>();
  for (const row of byContact ?? []) ids.add(row.id);
  for (const row of byShop ?? []) ids.add(row.seller_account_id);
  return Array.from(ids);
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    moderation?: string;
    error?: string;
    saved?: string;
  }>;
}) {
  // The layout redirects a non-operator; this is the handler's own check,
  // because every query below runs through the service-role client.
  await requireOperator("/admin/products");
  const { q, status, moderation, error: actionError, saved } = await searchParams;
  const term = q?.trim() ?? "";
  const admin = createAdminClient();

  let query = admin
    .from("products")
    .select(
      "id,name,sku,currency,price_minor,compare_at_price_minor,status,inventory_policy,stock_quantity,reserved_quantity,moderation_status,created_at,seller_account_id,product_media(object_path,position),seller_accounts(contact_name,shops(display_name))",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const productStatus = oneOf(status, PRODUCT_STATUSES);
  if (productStatus) query = query.eq("status", productStatus);
  if (moderation && MODERATION_FILTERS.some((f) => f.value === moderation)) {
    query = query.eq("moderation_status", moderation);
  }
  if (term) {
    const orParts = [`name.ilike.%${term}%`, `sku.ilike.%${term}%`];
    const sellerIds = await resolveMatchingSellerIds(admin, term);
    if (sellerIds.length) orParts.push(`seller_account_id.in.(${sellerIds.join(",")})`);
    query = query.or(orParts.join(","));
  }

  const sevenDaysAgo = isoDaysAgo(7);

  const [
    { data: products },
    { count: activeCount },
    { count: draftCount },
    { count: archivedCount },
    { count: flaggedCount },
    { count: hiddenCount },
    { count: recentCount },
    { data: trackedStock },
    { data: categories },
  ] = await Promise.all([
    query,
    admin.from("products").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("products").select("id", { count: "exact", head: true }).eq("status", "draft"),
    admin.from("products").select("id", { count: "exact", head: true }).eq("status", "archived"),
    admin.from("products").select("id", { count: "exact", head: true }).eq("moderation_status", "flagged"),
    admin.from("products").select("id", { count: "exact", head: true }).eq("moderation_status", "hidden"),
    admin.from("products").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    admin.from("products").select("stock_quantity,reserved_quantity").eq("inventory_policy", "track"),
    admin.from("categories").select("id,name,slug,active").order("position", { ascending: true }),
  ]);

  let lowStockCount = 0;
  let outOfStockCount = 0;
  for (const row of trackedStock ?? []) {
    const available = Math.max(0, (row.stock_quantity ?? 0) - row.reserved_quantity);
    if (available === 0) outOfStockCount += 1;
    else if (available <= 4) lowStockCount += 1;
  }

  const rows: AdminProductRow[] = (products ?? []).map((product) => {
    const sellerAccount = Array.isArray(product.seller_accounts)
      ? product.seller_accounts[0]
      : product.seller_accounts;
    const shop = sellerAccount
      ? Array.isArray(sellerAccount.shops)
        ? sellerAccount.shops[0]
        : sellerAccount.shops
      : null;
    const available =
      product.inventory_policy === "track"
        ? Math.max(0, (product.stock_quantity ?? 0) - product.reserved_quantity)
        : null;
    const outOfStock = product.inventory_policy === "track" && available === 0;
    const lowStock = !outOfStock && available != null && available <= 4;

    return {
      id: product.id,
      name: product.name,
      sellerName: shop?.display_name ?? sellerAccount?.contact_name ?? "Unknown seller",
      imageUrl: mainImageUrl(product.product_media),
      priceLabel: formatMoney(product.price_minor, product.currency as CurrencyCode),
      compareAtPriceLabel: product.compare_at_price_minor
        ? formatMoney(product.compare_at_price_minor, product.currency as CurrencyCode)
        : null,
      stockLabel: outOfStock
        ? "Out of stock"
        : lowStock
          ? `${available} left`
          : available != null
            ? `${available} in stock`
            : "Unlimited",
      stockTone: outOfStock ? "faint" : lowStock ? "warn" : "muted",
      status: product.status,
      moderationStatus: product.moderation_status,
    };
  });

  const exportParams = new URLSearchParams();
  if (term) exportParams.set("q", term);
  if (status) exportParams.set("status", status);
  if (moderation) exportParams.set("moderation", moderation);

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <ActionBanner error={actionError} saved={saved} />

      <PageHeader
        title="Products"
        sub="Every listing across the platform — search, moderate, and categorize."
        actions={
          <a
            href={`/api/admin/exports/products${exportParams.toString() ? `?${exportParams}` : ""}`}
            className="inline-flex h-10 items-center rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-ink no-underline transition-colors hover:border-[#B9AC98]"
          >
            Export CSV
          </a>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <MetricTile label="Active" value={String(activeCount ?? 0)} />
        <MetricTile label="Draft" value={String(draftCount ?? 0)} />
        <MetricTile label="Archived" value={String(archivedCount ?? 0)} />
        <MetricTile label="Listed this week" value={String(recentCount ?? 0)} />
        <MetricTile
          label="Low stock"
          value={String(lowStockCount)}
          sub={lowStockCount ? "4 units or fewer" : undefined}
          subTone="warn"
        />
        <MetricTile
          label="Out of stock"
          value={String(outOfStockCount)}
          subTone="warn"
        />
        <MetricTile
          label="Flagged"
          value={String(flaggedCount ?? 0)}
          sub={flaggedCount ? "Awaiting review" : undefined}
          subTone="warn"
        />
        <MetricTile
          label="Hidden"
          value={String(hiddenCount ?? 0)}
          sub={hiddenCount ? "Removed by operators" : undefined}
          subTone="warn"
        />
      </div>

      <form className="mb-4 flex gap-2">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        {moderation ? <input type="hidden" name="moderation" value={moderation} /> : null}
        <input
          name="q"
          defaultValue={term}
          placeholder="Search by name, SKU, or seller…"
          aria-label="Search products"
          className="h-11 min-w-0 flex-1 rounded-[10px] border border-line-input bg-white px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <button
          type="submit"
          className="h-11 cursor-pointer rounded-[10px] border-none bg-ink px-4.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-ink-2"
        >
          Search
        </button>
      </form>

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <FilterPills
          pills={STATUS_FILTERS.map((f) => ({
            label: f.label,
            href: buildFilterHref({ q: term, status: f.value, moderation }),
            active: (status ?? "") === f.value,
          }))}
        />
        <FilterPills
          pills={MODERATION_FILTERS.map((f) => ({
            label: f.label,
            href: buildFilterHref({ q: term, status, moderation: f.value }),
            active: (moderation ?? "") === f.value,
          }))}
        />
      </div>

      {!rows.length ? (
        <EmptyState title="No products found" body="Try a different search or filter." />
      ) : (
        <ProductListWithBulkActions products={rows} />
      )}

      <Panel className="mt-6 overflow-hidden">
        <details>
          <summary className="cursor-pointer list-none px-4.5 py-3.5 text-[14px] font-bold text-ink [&::-webkit-details-marker]:hidden">
            Manage categories →
          </summary>
          <div className="border-t border-line-soft px-4.5 py-4">
            <form action={createCategoryAction} className="mb-4 flex flex-wrap gap-2">
              <input
                name="name"
                required
                placeholder="Category name"
                className="h-10 min-w-0 flex-1 rounded-[10px] border border-line-input bg-white px-3.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
              <input
                name="description"
                placeholder="Description (optional)"
                className="h-10 min-w-0 flex-1 rounded-[10px] border border-line-input bg-white px-3.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
              <SubmitButton
                className="h-10 cursor-pointer rounded-[10px] border-none bg-ink px-4 text-[13px] font-semibold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
                pendingLabel="Adding…"
              >
                Add category
              </SubmitButton>
            </form>

            {!categories?.length ? (
              <p className="text-[13px] text-ink-soft">No categories yet.</p>
            ) : (
              <div className="grid gap-2">
                {categories.map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between gap-3 rounded-[10px] border border-line-soft px-3.5 py-2.5"
                  >
                    <span className={`text-[13.5px] font-semibold ${category.active ? "text-ink" : "text-ink-faint line-through"}`}>
                      {category.name}
                    </span>
                    <form action={setCategoryActiveAction}>
                      <input name="categoryId" type="hidden" value={category.id} />
                      <input name="active" type="hidden" value={category.active ? "false" : "true"} />
                      <SubmitButton
                        className="text-[12.5px] font-semibold text-accent hover:underline disabled:cursor-wait disabled:opacity-60"
                        pendingLabel={category.active ? "Archiving…" : "Restoring…"}
                      >
                        {category.active ? "Archive" : "Restore"}
                      </SubmitButton>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      </Panel>
    </main>
  );
}

function buildFilterHref({
  q,
  status,
  moderation,
}: {
  q: string;
  status?: string;
  moderation?: string;
}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (moderation) params.set("moderation", moderation);
  const query = params.toString();
  return query ? `/admin/products?${query}` : "/admin/products";
}
