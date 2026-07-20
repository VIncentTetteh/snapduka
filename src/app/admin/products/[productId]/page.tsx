import Link from "next/link";
import { notFound } from "next/navigation";

import { setProductCategoriesAction, setProductModerationAction } from "@/app/admin/products/actions";
import { ModerationBadge } from "@/components/admin/moderation-badge";
import { ProductStatusBadge } from "@/components/seller/status-badges";
import { PageHeader, Panel } from "@/components/ui/surface";
import { FormActionButton, SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/i18n";
import { publicMediaUrl } from "@/lib/storefront/media";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/countries/types";

export const dynamic = "force-dynamic";

const MODERATION_ACTIONS = [
  { value: "flagged", label: "Flag for review", tone: "warn" as const },
  { value: "hidden", label: "Hide from storefront", tone: "danger" as const },
  { value: "clear", label: "Clear moderation", tone: "success" as const },
];

export default async function AdminProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const admin = createAdminClient();

  const [
    { data: product },
    { data: variants },
    { data: media },
    { data: history },
    { data: categories },
    { data: assignedCategories },
  ] = await Promise.all([
    admin
      .from("products")
      .select(
        "id,name,sku,currency,price_minor,status,inventory_policy,stock_quantity,reserved_quantity,moderation_status,moderation_reason,moderated_at,created_at,seller_account_id,seller_accounts(id,contact_name,contact_email,shops(display_name))",
      )
      .eq("id", productId)
      .maybeSingle(),
    admin
      .from("product_variants")
      .select("id,name,sku,price_minor,stock_quantity,active")
      .eq("product_id", productId)
      .order("position", { ascending: true }),
    admin.from("product_media").select("object_path,position").eq("product_id", productId).order("position"),
    admin
      .from("audit_events")
      .select("id,action,after_data,occurred_at")
      .eq("entity_type", "product")
      .eq("entity_id", productId)
      .order("occurred_at", { ascending: false })
      .limit(20),
    admin.from("categories").select("id,name").eq("active", true).order("position", { ascending: true }),
    admin.from("product_categories").select("category_id").eq("product_id", productId),
  ]);

  if (!product) notFound();

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
  const assignedIds = new Set((assignedCategories ?? []).map((row) => row.category_id));

  return (
    <main className="sd-main mx-auto max-w-[1080px] px-4 pt-6 sm:px-6">
      <Link
        href="/admin/products"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted no-underline hover:text-ink"
      >
        ← Products
      </Link>
      <PageHeader
        eyebrow="Product moderation"
        title={product.name}
        sub={sellerAccount ? `${shop?.display_name ?? sellerAccount.contact_name} · ${sellerAccount.contact_email}` : undefined}
        actions={
          <span className="flex gap-1.5">
            <ProductStatusBadge status={product.status} />
            <ModerationBadge status={product.moderation_status} />
          </span>
        }
      />

      {sellerAccount ? (
        <Link
          href={`/admin/sellers/${sellerAccount.id}`}
          className="mb-5 inline-block text-[12.5px] font-semibold text-accent no-underline hover:underline"
        >
          View seller →
        </Link>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Panel className="p-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-muted">Price</p>
          <p className="font-serif text-[22px] font-medium text-ink">
            {formatMoney(product.price_minor, product.currency as CurrencyCode)}
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-muted">Available stock</p>
          <p className="font-serif text-[22px] font-medium text-ink">
            {available != null ? available : "Unlimited"}
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-muted">Variants</p>
          <p className="font-serif text-[22px] font-medium text-ink">{variants?.length ?? 0}</p>
        </Panel>
        <Panel className="p-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-muted">Categories</p>
          <p className="font-serif text-[22px] font-medium text-ink">{assignedIds.size}</p>
        </Panel>
      </div>

      {media?.length ? (
        <Panel className="mb-5 p-4.5">
          <h2 className="mb-3 text-[14px] font-bold text-ink">Images</h2>
          <div className="flex flex-wrap gap-3">
            {media.map((item) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={item.object_path}
                alt=""
                src={publicMediaUrl(item.object_path) ?? undefined}
                className="h-20 w-20 rounded-xl object-cover"
              />
            ))}
          </div>
        </Panel>
      ) : null}

      {variants?.length ? (
        <Panel className="mb-5 overflow-hidden">
          <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold text-ink">Variants</h2>
          {variants.map((variant) => (
            <div
              key={variant.id}
              className="flex items-center justify-between gap-3 border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0"
            >
              <span className="text-[13.5px] font-semibold text-ink">
                {variant.name}
                {variant.sku ? <span className="ml-2 text-[12px] font-normal text-ink-muted">{variant.sku}</span> : null}
              </span>
              <span className="text-[13px] text-ink-soft">
                {variant.price_minor != null ? formatMoney(variant.price_minor, product.currency as CurrencyCode) : "—"}
                {" · "}
                {variant.stock_quantity ?? "Unlimited"} in stock
                {!variant.active ? " · Inactive" : ""}
              </span>
            </div>
          ))}
        </Panel>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel className="border-danger-line p-4.5">
          <h2 className="mb-1 text-[14px] font-bold text-ink">Moderation</h2>
          <p className="mb-3.5 text-[12.5px] leading-[1.55] text-ink-soft">
            Hiding removes the listing from the storefront immediately, regardless of the
            seller&apos;s own publish toggle. Recorded with your name and reason in the audit log.
          </p>
          {product.moderation_reason ? (
            <p className="mb-3.5 rounded-[10px] border border-line bg-raised px-3.5 py-2.5 text-[12.5px] text-ink-soft">
              <strong className="font-bold text-ink">Last reason:</strong> {product.moderation_reason}
            </p>
          ) : null}
          <form action={setProductModerationAction} className="grid gap-3">
            <input name="productId" type="hidden" value={product.id} />
            <label className="grid gap-1.5 text-[12.5px] font-semibold text-ink" htmlFor="moderation-reason">
              Operational reason (required)
              <textarea
                id="moderation-reason"
                name="reason"
                required
                rows={2}
                placeholder="e.g. Counterfeit item reported by a buyer"
                className="w-full resize-y rounded-[10px] border border-line-input bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <div className="flex flex-wrap gap-2.5">
              {MODERATION_ACTIONS.map((action) => (
                <FormActionButton
                  key={action.value}
                  name="decision"
                  value={action.value}
                  pendingLabel={`${action.label}…`}
                  className={`min-h-10 cursor-pointer rounded-[10px] px-4.5 text-[13px] font-bold transition-colors disabled:cursor-wait disabled:opacity-60 ${
                    action.tone === "danger"
                      ? "border-none bg-danger text-white hover:opacity-90"
                      : action.tone === "success"
                        ? "border border-line-strong bg-white text-ink hover:border-[#B9AC98]"
                        : "border-none bg-warn text-white hover:opacity-90"
                  }`}
                >
                  {action.label}
                </FormActionButton>
              ))}
            </div>
          </form>
        </Panel>

        <Panel className="overflow-hidden">
          <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold text-ink">
            Moderation history
          </h2>
          {!history?.length ? (
            <p className="px-4.5 py-8 text-center text-[13px] text-ink-soft">
              No moderation events recorded for this product.
            </p>
          ) : (
            history.map((event) => {
              const after = event.after_data as { reason?: string } | null;
              return (
                <div key={event.id} className="border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0">
                  <p className="text-[13px] font-semibold capitalize text-ink">
                    {event.action.replace(/_/g, " ")}
                  </p>
                  {after?.reason ? <p className="mt-0.5 text-[12px] text-ink-soft">{after.reason}</p> : null}
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {new Date(event.occurred_at).toLocaleString()}
                  </p>
                </div>
              );
            })
          )}
        </Panel>
      </div>

      <Panel className="mt-4 p-4.5">
        <h2 className="mb-3 text-[14px] font-bold text-ink">Categories</h2>
        {!categories?.length ? (
          <p className="text-[13px] text-ink-soft">
            No active categories yet — add one from the products list page.
          </p>
        ) : (
          <form action={setProductCategoriesAction} className="grid gap-3">
            <input name="productId" type="hidden" value={product.id} />
            <div className="flex flex-wrap gap-3">
              {categories.map((category) => (
                <label
                  key={category.id}
                  className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-line-strong px-3.5 py-2 text-[13px] font-semibold text-ink"
                >
                  <input
                    type="checkbox"
                    name="categoryIds"
                    value={category.id}
                    defaultChecked={assignedIds.has(category.id)}
                    className="h-[15px] w-[15px] accent-accent"
                  />
                  {category.name}
                </label>
              ))}
            </div>
            <SubmitButton
              className="min-h-10 w-fit cursor-pointer rounded-[10px] border-none bg-ink px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
              pendingLabel="Saving…"
            >
              Save categories
            </SubmitButton>
          </form>
        )}
      </Panel>
    </main>
  );
}
