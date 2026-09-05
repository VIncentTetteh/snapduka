import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { addVariantAction, archiveVariantAction, setProductVideoAction, updateProductAction, updateVariantAction } from "@/app/(seller)/dashboard/products/actions";
import { ProductMediaManager } from "@/components/seller/product-media-manager";
import { Req } from "@/components/ui/required-mark";
import { FormActionButton, SubmitButton } from "@/components/ui/submit-button";
import { MetricTile } from "@/components/ui/metric-tile";
import { resolveServerActor } from "@/lib/auth/actor";
import type { CurrencyCode } from "@/lib/countries/types";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

/** This page reports all time. */
const EPOCH = "1970-01-01T00:00:00Z";

export default async function EditProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") redirect("/login?next=/dashboard/products");
  const { productId } = await params;
  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("id,name,description,currency,price_minor,cost_minor,compare_at_price_minor,sku,status,inventory_policy,stock_quantity,reserved_quantity,video_url,product_media(id,object_path,position),product_variants(id,name,sku,price_minor,inventory_policy,stock_quantity,reserved_quantity,active)").eq("id", productId).eq("seller_account_id", actor.sellerAccountId).maybeSingle();
  if (!product) notFound();

  // Aggregated in SQL. This pulled every paid line for the product to produce a
  // single row, so a best-seller past db.max_rows had its units, revenue and
  // margin computed from a truncated set — the products that sell most being
  // exactly the ones to get this wrong on.
  const { data: profitRows } = await supabase.rpc("seller_product_profit_for", {
    p_product_id: productId,
    p_from: EPOCH,
    p_to: new Date().toISOString(),
  });
  const profitRow = profitRows?.[0];
  const profit = profitRow
    ? {
        unitsSold: Number(profitRow.units_sold),
        revenueMinor: Number(profitRow.revenue_minor),
        // Null rather than zero when a cost was never entered: unknown profit
        // is not the same as no profit.
        costMinor: profitRow.cost_minor == null ? null : Number(profitRow.cost_minor),
        profitMinor: profitRow.profit_minor == null ? null : Number(profitRow.profit_minor),
      }
    : undefined;

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-24">
      <header>
        <div className="mb-3 flex flex-wrap gap-2">
          <Link className="btn-secondary w-max" href="/dashboard/products">← Products</Link>
          <Link className="btn-primary w-max" href={`/dashboard/share?product=${product.id}`}>
            Share this product →
          </Link>
        </div>
        <p className="page-eyebrow m-0">Catalog</p>
        <h1 className="page-title mt-1">Edit {product.name}</h1>
        <p className="page-sub">Changes to published products appear on your storefront immediately.</p>
      </header>

      <form action={updateProductAction} className="card grid gap-3">
        <input name="productId" type="hidden" value={product.id} />
        <input name="currency" type="hidden" value={product.currency} />
        <label className="grid gap-1"><span className="field-label">Name<Req /></span><input className="field-input" defaultValue={product.name} minLength={2} name="name" required aria-required="true" /></label>
        <label className="grid gap-1"><span className="field-label">Description <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional)</span></span><textarea className="field-input" defaultValue={product.description} name="description" rows={4} /></label>
        <label className="grid gap-1"><span className="field-label">Price ({product.currency} minor units)<Req /></span><input className="field-input" defaultValue={product.price_minor} inputMode="numeric" name="price" pattern="[1-9][0-9]*" title="Whole number in minor units, greater than zero" required aria-required="true" /></label>
        <label className="grid gap-1"><span className="field-label">Compare-at price ({product.currency} minor units) <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional)</span></span><input className="field-input" defaultValue={product.compare_at_price_minor ?? ""} inputMode="numeric" name="compareAtPrice" pattern="[0-9]*" title="Whole number in minor units, greater than your price" /></label>
        <label className="grid gap-1"><span className="field-label">Your cost ({product.currency} minor units) <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional, never shown to buyers)</span></span><input className="field-input" defaultValue={product.cost_minor ?? ""} inputMode="numeric" name="costPrice" pattern="[0-9]*" title="Whole number in minor units" /></label>
        <label className="grid gap-1"><span className="field-label">SKU <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional)</span></span><input className="field-input" defaultValue={product.sku ?? ""} name="sku" /></label>
        <label className="grid gap-1"><span className="field-label">Availability</span><select className="field-input" defaultValue={product.inventory_policy} name="inventoryPolicy"><option value="track">Track finite stock</option><option value="continue_selling">Preorder</option><option value="deny_when_out_of_stock">Always available</option></select></label>
        <label className="grid gap-1"><span className="field-label">Stock quantity (at least {product.reserved_quantity} reserved)</span><input className="field-input" defaultValue={product.stock_quantity ?? ""} inputMode="numeric" min={product.reserved_quantity} name="stockQuantity" pattern="[0-9]*" title="Whole number" /></label>
        <label className="grid gap-1"><span className="field-label">Status</span><select className="field-input" defaultValue={product.status === "archived" ? "draft" : product.status} name="status"><option value="draft">Draft</option><option value="active">Published</option></select></label>
        <SubmitButton className="btn-primary w-full" pendingLabel="Saving…">Save product</SubmitButton>
      </form>

      <section className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Photos</h2>
        <p className="m-0 text-sm" style={{ color: "var(--ink-2)" }}>
          Add up to a few photos — the main image is what customers see first on your storefront.
        </p>
        <ProductMediaManager media={product.product_media ?? []} productId={product.id} />
      </section>

      <section className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Profit</h2>
        {profit ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile label="Units sold" value={String(profit.unitsSold)} />
            <MetricTile label="Revenue" value={formatMoney(profit.revenueMinor, product.currency as CurrencyCode)} />
            <MetricTile label="Cost" value={profit.costMinor == null ? "Unknown" : formatMoney(profit.costMinor, product.currency as CurrencyCode)} />
            <MetricTile label="Profit" value={profit.profitMinor == null ? "Unknown" : formatMoney(profit.profitMinor, product.currency as CurrencyCode)} />
          </div>
        ) : (
          <p className="m-0 text-sm" style={{ color: "var(--ink-2)" }}>No paid sales yet.</p>
        )}
      </section>

      <section className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Product video</h2>
        <p className="m-0 text-sm" style={{ color: "var(--ink-2)" }}>
          Paste a link to a video you&apos;ve already posted — YouTube, TikTok, Instagram Reels, or
          anywhere else. It shows as the first slide in your product gallery.
        </p>
        <form action={setProductVideoAction} className="grid gap-2">
          <input name="productId" type="hidden" value={product.id} />
          <input
            className="field-input"
            defaultValue={product.video_url ?? ""}
            name="videoUrl"
            placeholder="https://www.youtube.com/watch?v=..."
            type="url"
          />
          <SubmitButton className="btn-primary w-full" pendingLabel="Saving…">Save video</SubmitButton>
        </form>
        {product.video_url ? (
          <form action={setProductVideoAction}>
            <input name="productId" type="hidden" value={product.id} />
            <input name="videoUrl" type="hidden" value="" />
            <SubmitButton className="btn-secondary w-full" pendingLabel="Removing…">Remove video</SubmitButton>
          </form>
        ) : null}
      </section>

      <section className="grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Variants</h2>
        {product.product_variants.map((variant) => (
          <form action={updateVariantAction} className="card grid gap-2" key={variant.id}>
            <input name="productId" type="hidden" value={product.id} /><input name="variantId" type="hidden" value={variant.id} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><input className="field-input" defaultValue={variant.name} name="name" placeholder="Name" required /><input className="field-input" defaultValue={variant.sku ?? ""} name="sku" placeholder="SKU" /></div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><input className="field-input" defaultValue={variant.price_minor ?? ""} inputMode="numeric" name="price" pattern="[0-9]*" title="Whole number in minor units" placeholder="Price (blank uses product price)" /><input className="field-input" defaultValue={variant.stock_quantity ?? ""} inputMode="numeric" min={variant.reserved_quantity} name="stock" pattern="[0-9]*" title="Whole number" placeholder="Stock" /></div>
            <div className="flex gap-2"><select className="field-input" defaultValue={variant.inventory_policy} name="inventoryPolicy"><option value="track">Track stock</option><option value="continue_selling">Preorder</option><option value="deny_when_out_of_stock">Always available</option></select><select className="field-input" defaultValue={String(variant.active)} name="active"><option value="true">Active</option><option value="false">Hidden</option></select></div>
            <div className="flex gap-2"><FormActionButton className="btn-primary flex-1" formAction={updateVariantAction} pendingLabel="Saving…">Save variant</FormActionButton><FormActionButton className="btn-secondary" formAction={archiveVariantAction} pendingLabel="Hiding…">Hide</FormActionButton></div>
          </form>
        ))}
        <form action={addVariantAction} className="card grid gap-2">
          <h3 className="m-0 font-bold">Add variant</h3><input name="productId" type="hidden" value={product.id} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><input className="field-input" minLength={2} name="name" placeholder="Name, e.g. Large *" required aria-required="true" /><input className="field-input" name="sku" placeholder="SKU" /></div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><input className="field-input" inputMode="numeric" name="price" pattern="[0-9]*" title="Whole number in minor units" placeholder="Price (blank uses product price)" /><input className="field-input" inputMode="numeric" name="stock" pattern="[0-9]*" title="Whole number" placeholder="Stock" /></div>
          <input name="active" type="hidden" value="true" /><select className="field-input" defaultValue="track" name="inventoryPolicy"><option value="track">Track stock</option><option value="continue_selling">Preorder</option><option value="deny_when_out_of_stock">Always available</option></select>
          <SubmitButton className="btn-primary w-full" pendingLabel="Adding…">Add variant</SubmitButton>
        </form>
      </section>
    </main>
  );
}
