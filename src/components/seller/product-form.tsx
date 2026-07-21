"use client";

import { useEffect, useState, useActionState } from "react";

import {
  createProductAction,
  type ProductActionState,
} from "@/app/(seller)/dashboard/products/actions";
import { ImageUploader } from "@/components/seller/image-uploader";
import { Req } from "@/components/ui/required-mark";
import { type PreparedImage, prepareImage, validateProductImage } from "@/lib/catalog/images";

const initialState: ProductActionState = { status: "idle", values: {} };

const currencySymbol: Record<string, string> = {
  GHS: "₵",
  NGN: "₦",
  XOF: "Fr",
};

function fieldError(
  state: ProductActionState,
  field: string,
): string | undefined {
  return state.fieldErrors?.[field]?.[0];
}

function InputError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p className="field-error m-0" id={id}>
      {message}
    </p>
  ) : null;
}

export function ProductForm({ currency }: { currency: "GHS" | "NGN" | "XOF" }) {
  const [state, action, pending] = useActionState(createProductAction, initialState);
  const [priceValue, setPriceValue] = useState(state.values.price ?? "");
  const [compareAtValue, setCompareAtValue] = useState(state.values.compareAtPrice ?? "");
  const [preparedImage, setPreparedImage] = useState<PreparedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const symbol = currencySymbol[currency] ?? currency;

  const priceDisplay =
    priceValue && /^\d+$/.test(priceValue)
      ? `= ${symbol}${(Number(priceValue) / 100).toFixed(2)}`
      : null;

  function inputClass(field: string) {
    return `field-input${fieldError(state, field) ? " error" : ""}`;
  }

  async function handleImagePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const validation = validateProductImage(file);
    if (!validation.valid) {
      setImageError(validation.message);
      setPreparedImage(null);
      return;
    }
    setImageError(null);
    try {
      setPreparedImage(await prepareImage(file));
    } catch {
      setImageError("Could not prepare this image. Try another photo.");
      setPreparedImage(null);
    }
  }

  useEffect(() => {
    if (state.status === "success") {
      queueMicrotask(() => {
        setPreparedImage(null);
        setImageError(null);
        setCompareAtValue("");
      });
    }
  }, [state.status, state.productId]);

  return (
    <div className="grid gap-4">
      <form action={action} className="card grid gap-3">
        <h2 className="m-0 text-xl font-extrabold" style={{ color: "var(--ink)" }}>
          Add a product
        </h2>

        {state.message ? (
          <div
            className={`alert ${state.status === "error" ? "alert-error" : "alert-success"}`}
            role={state.status === "error" ? "alert" : "status"}
          >
            {state.message}
          </div>
        ) : null}

        <div className="grid gap-1">
          <label className="field-label" htmlFor="name">Name<Req /></label>
          <input
            aria-describedby={fieldError(state, "name") ? "name-error" : undefined}
            className={inputClass("name")}
            defaultValue={state.values.name}
            id="name"
            name="name"
            required
          />
          <InputError id="name-error" message={fieldError(state, "name")} />
        </div>

        <div className="grid gap-1">
          <label className="field-label" htmlFor="description">Description <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional)</span></label>
          <textarea
            className="field-input"
            defaultValue={state.values.description}
            id="description"
            name="description"
            rows={3}
          />
        </div>

        <div className="grid gap-1">
          <label className="field-label" htmlFor="price">
            Price ({currency} minor units — e.g. 5000 = {symbol}50.00)<Req />
          </label>
          <input
            aria-describedby={fieldError(state, "price") ? "price-error" : undefined}
            className={inputClass("price")}
            defaultValue={state.values.price}
            id="price"
            inputMode="numeric"
            name="price"
            onChange={(e) => setPriceValue(e.target.value.replace(/[^0-9]/g, ""))}
            pattern="[1-9][0-9]*"
            title="Whole number in minor units, greater than zero"
            required
            aria-required="true"
            value={priceValue}
          />
          {priceDisplay ? (
            <p className="field-help m-0">{priceDisplay}</p>
          ) : null}
          <InputError id="price-error" message={fieldError(state, "price")} />
        </div>

        <div className="grid gap-1">
          <label className="field-label" htmlFor="compareAtPrice">
            Compare-at price <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional — shown struck through next to your price)</span>
          </label>
          <input
            aria-describedby={fieldError(state, "compareAtPrice") ? "compare-at-error" : undefined}
            className={inputClass("compareAtPrice")}
            id="compareAtPrice"
            inputMode="numeric"
            name="compareAtPrice"
            onChange={(e) => setCompareAtValue(e.target.value.replace(/[^0-9]/g, ""))}
            pattern="[0-9]*"
            title="Whole number in minor units, greater than your price"
            value={compareAtValue}
          />
          {compareAtValue && /^\d+$/.test(compareAtValue) ? (
            <p className="field-help m-0">= {symbol}{(Number(compareAtValue) / 100).toFixed(2)}</p>
          ) : null}
          <InputError id="compare-at-error" message={fieldError(state, "compareAtPrice")} />
        </div>

        <div className="grid gap-1">
          <label className="field-label" htmlFor="costPrice">
            Your cost <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional — never shown to buyers, used to track profit)</span>
          </label>
          <input
            aria-describedby={fieldError(state, "costPrice") ? "cost-error" : undefined}
            className={inputClass("costPrice")}
            defaultValue={state.values.costPrice}
            id="costPrice"
            inputMode="numeric"
            name="costPrice"
            pattern="[0-9]*"
            title="Whole number in minor units"
          />
          <InputError id="cost-error" message={fieldError(state, "costPrice")} />
        </div>

        <input name="currency" type="hidden" value={currency} />

        <div className="grid gap-1">
          <label className="field-label" htmlFor="sku">SKU <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional)</span></label>
          <input
            aria-describedby={fieldError(state, "sku") ? "sku-error" : undefined}
            className={inputClass("sku")}
            defaultValue={state.values.sku}
            id="sku"
            name="sku"
          />
          <InputError id="sku-error" message={fieldError(state, "sku")} />
        </div>

        <div className="grid gap-1">
          <label className="field-label" htmlFor="inventoryPolicy">Availability</label>
          <select
            aria-describedby={fieldError(state, "inventoryPolicy") ? "inventory-policy-error" : undefined}
            className="field-input"
            defaultValue={state.values.inventoryPolicy || "track"}
            id="inventoryPolicy"
            name="inventoryPolicy"
          >
            <option value="track">Track finite stock</option>
            <option value="continue_selling">Preorder</option>
            <option value="deny_when_out_of_stock">Always available</option>
          </select>
          <InputError id="inventory-policy-error" message={fieldError(state, "inventoryPolicy")} />
        </div>

        <div className="grid gap-1">
          <label className="field-label" htmlFor="stockQuantity">Stock quantity</label>
          <input
            aria-describedby={fieldError(state, "stockQuantity") ? "stock-quantity-error" : undefined}
            className={inputClass("stockQuantity")}
            defaultValue={state.values.stockQuantity}
            id="stockQuantity"
            inputMode="numeric"
            name="stockQuantity"
            pattern="[0-9]*"
            title="Whole number"
          />
          <InputError id="stock-quantity-error" message={fieldError(state, "stockQuantity")} />
        </div>

        <div className="grid gap-1">
          <label className="field-label" htmlFor="videoUrl">
            Product video <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional — YouTube, TikTok, Instagram Reels…)</span>
          </label>
          <input
            aria-describedby={fieldError(state, "videoUrl") ? "video-url-error" : undefined}
            className={inputClass("videoUrl")}
            defaultValue={state.values.videoUrl}
            id="videoUrl"
            name="videoUrl"
            placeholder="https://www.youtube.com/watch?v=..."
            type="url"
          />
          <InputError id="video-url-error" message={fieldError(state, "videoUrl")} />
        </div>

        <div className="grid gap-1">
          <label className="field-label" htmlFor="productImage">
            Photo <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional — JPEG, PNG, or WebP)</span>
          </label>
          <input
            accept="image/jpeg,image/png,image/webp"
            className="text-sm"
            id="productImage"
            onChange={handleImagePick}
            style={{ color: "var(--ink-2)" }}
            type="file"
          />
          {preparedImage ? (
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Photo preview" className="h-16 w-16 rounded-xl border object-cover" src={preparedImage.dataUrl} style={{ borderColor: "var(--border)" }} />
              <p className="field-help m-0">Ready — will be attached when you save.</p>
            </div>
          ) : null}
          {imageError ? <p className="field-error m-0">{imageError}</p> : null}
          <input name="imageDataUrl" type="hidden" value={preparedImage?.dataUrl ?? ""} />
          <input name="imageWidth" type="hidden" value={preparedImage?.width ?? ""} />
          <input name="imageHeight" type="hidden" value={preparedImage?.height ?? ""} />
        </div>

        <fieldset
          className="grid gap-2 rounded-xl p-3"
          style={{ border: "1.5px dashed var(--border)" }}
        >
          <legend className="field-label px-1">Optional first variant</legend>
          <input className="field-input" defaultValue={state.values.variantName} name="variantName" placeholder="Variant name, e.g. Large" />
          <input className="field-input" defaultValue={state.values.variantPrice} inputMode="numeric" name="variantPrice" pattern="[0-9]*" placeholder="Variant price in minor units" />
          <input className="field-input" defaultValue={state.values.variantSku} name="variantSku" placeholder="Variant SKU" />
          <input className="field-input" defaultValue={state.values.variantStock} inputMode="numeric" name="variantStock" pattern="[0-9]*" placeholder="Variant stock" />
        </fieldset>

        <div className="grid gap-1">
          <label className="field-label" htmlFor="status">Save as</label>
          <select className="field-input" defaultValue={state.values.status || "draft"} id="status" name="status">
            <option value="draft">Draft</option>
            <option value="active">Published</option>
          </select>
        </div>

        <button className="btn-primary w-full" disabled={pending} type="submit">
          {pending ? "Saving..." : "Save product"}
        </button>
      </form>

      {state.status === "success" && state.productId ? (
        <ImageUploader productId={state.productId} />
      ) : null}
    </div>
  );
}
