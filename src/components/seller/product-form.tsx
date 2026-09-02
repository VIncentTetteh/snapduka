"use client";

import { useActionState, useEffect, useState } from "react";

import {
  createProductAction,
  type ProductActionState,
} from "@/app/(seller)/dashboard/products/actions";
import { ImageUploader } from "@/components/seller/image-uploader";
import { Button } from "@/components/ui/button";
import { Field, inputClasses } from "@/components/ui/field";
import { type PreparedImage, prepareImage, validateProductImage } from "@/lib/catalog/images";

const initialState: ProductActionState = { status: "idle", values: {} };

const currencySymbol: Record<string, string> = {
  GHS: "₵",
  NGN: "₦",
  XOF: "CFA",
};

function fieldError(state: ProductActionState, field: string) {
  return state.fieldErrors?.[field]?.[0];
}

function ProductField({
  state,
  name,
  label,
  optional,
  help,
  children,
  className,
}: {
  state: ProductActionState;
  name: string;
  label: string;
  optional?: boolean;
  help?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Field
      className={className}
      error={fieldError(state, name)}
      help={help}
      htmlFor={`product-${name}`}
      label={label}
      optional={optional}
    >
      {children}
    </Field>
  );
}

function minorToMajor(value: string | undefined, currency: string) {
  if (!value || !/^\d+$/.test(value)) return "";
  const factor = currency === "XOF" ? 1 : 100;
  return String(Number(value) / factor);
}

function majorToMinor(value: string, currency: string) {
  if (!value.trim()) return "";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return String(Math.round(amount * (currency === "XOF" ? 1 : 100)));
}

export function ProductForm({ currency }: { currency: "GHS" | "NGN" | "XOF" }) {
  const [state, action, pending] = useActionState(createProductAction, initialState);
  const [price, setPrice] = useState(() => minorToMajor(state.values.price, currency));
  const [compareAt, setCompareAt] = useState(() =>
    minorToMajor(state.values.compareAtPrice, currency),
  );
  const [cost, setCost] = useState(() => minorToMajor(state.values.costPrice, currency));
  const [variantPrice, setVariantPrice] = useState(() =>
    minorToMajor(state.values.variantPrice, currency),
  );
  const [preparedImage, setPreparedImage] = useState<PreparedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const symbol = currencySymbol[currency] ?? currency;
  const priceStep = currency === "XOF" ? "1" : "0.01";

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
      });
    }
  }, [state.status, state.productId]);

  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-6">
        {state.message ? (
          <div
            className={`rounded-xl border px-4 py-3 text-[13px] font-semibold ${
              state.status === "error"
                ? "border-danger-line bg-danger-tint text-danger"
                : "border-[#BFE3D2] bg-[#E7F4EE] text-success"
            }`}
            role={state.status === "error" ? "alert" : "status"}
          >
            {state.message}
          </div>
        ) : null}

        <section aria-labelledby="product-basics-heading" className="grid gap-4">
          <div>
            <h3 id="product-basics-heading" className="text-[14px] font-bold text-ink">
              Product details
            </h3>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              Start with the essentials. You can add more detail later.
            </p>
          </div>
          <ProductField state={state} name="name" label="Product name">
            <input
              aria-invalid={Boolean(fieldError(state, "name"))}
              className={inputClasses(Boolean(fieldError(state, "name")))}
              defaultValue={state.values.name}
              id="product-name"
              name="name"
              placeholder="e.g. Shea body butter"
              required
            />
          </ProductField>
          <ProductField state={state} name="description" label="Description" optional>
            <textarea
              className={inputClasses(false, "min-h-[96px] resize-y")}
              defaultValue={state.values.description}
              id="product-description"
              name="description"
              placeholder="What makes this product worth buying?"
              rows={3}
            />
          </ProductField>
        </section>

        <section aria-labelledby="product-pricing-heading" className="grid gap-4 border-t border-line-soft pt-5">
          <div>
            <h3 id="product-pricing-heading" className="text-[14px] font-bold text-ink">
              Pricing
            </h3>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              Enter prices exactly as your customers see them.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <ProductField state={state} name="price" label="Selling price">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[13px] font-semibold text-ink-muted">
                  {symbol}
                </span>
                <input
                  aria-invalid={Boolean(fieldError(state, "price"))}
                  className={inputClasses(Boolean(fieldError(state, "price")), "pl-12")}
                  id="product-price"
                  inputMode="decimal"
                  min={priceStep}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="0.00"
                  required
                  step={priceStep}
                  type="number"
                  value={price}
                />
              </div>
              <input name="price" type="hidden" value={majorToMinor(price, currency)} />
            </ProductField>
            <ProductField state={state} name="compareAtPrice" label="Compare-at" optional help="Shown crossed out">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[13px] font-semibold text-ink-muted">
                  {symbol}
                </span>
                <input
                  className={inputClasses(Boolean(fieldError(state, "compareAtPrice")), "pl-12")}
                  id="product-compareAtPrice"
                  inputMode="decimal"
                  min="0"
                  onChange={(event) => setCompareAt(event.target.value)}
                  placeholder="0.00"
                  step={priceStep}
                  type="number"
                  value={compareAt}
                />
              </div>
              <input name="compareAtPrice" type="hidden" value={majorToMinor(compareAt, currency)} />
            </ProductField>
            <ProductField state={state} name="costPrice" label="Your cost" optional help="Private; used for profit">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[13px] font-semibold text-ink-muted">
                  {symbol}
                </span>
                <input
                  className={inputClasses(Boolean(fieldError(state, "costPrice")), "pl-12")}
                  id="product-costPrice"
                  inputMode="decimal"
                  min="0"
                  onChange={(event) => setCost(event.target.value)}
                  placeholder="0.00"
                  step={priceStep}
                  type="number"
                  value={cost}
                />
              </div>
              <input name="costPrice" type="hidden" value={majorToMinor(cost, currency)} />
            </ProductField>
          </div>
          <input name="currency" type="hidden" value={currency} />
        </section>

        <section aria-labelledby="product-inventory-heading" className="grid gap-4 border-t border-line-soft pt-5">
          <div>
            <h3 id="product-inventory-heading" className="text-[14px] font-bold text-ink">
              Inventory &amp; visibility
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ProductField state={state} name="inventoryPolicy" label="Availability">
              <select
                className={inputClasses(Boolean(fieldError(state, "inventoryPolicy")))}
                defaultValue={state.values.inventoryPolicy || "track"}
                id="product-inventoryPolicy"
                name="inventoryPolicy"
              >
                <option value="track">Track stock</option>
                <option value="continue_selling">Accept preorders</option>
                <option value="deny_when_out_of_stock">Always available</option>
              </select>
            </ProductField>
            <ProductField state={state} name="stockQuantity" label="Quantity">
              <input
                className={inputClasses(Boolean(fieldError(state, "stockQuantity")))}
                defaultValue={state.values.stockQuantity || "0"}
                id="product-stockQuantity"
                inputMode="numeric"
                min="0"
                name="stockQuantity"
                step="1"
                type="number"
              />
            </ProductField>
            <ProductField state={state} name="sku" label="SKU" optional>
              <input
                className={inputClasses(Boolean(fieldError(state, "sku")))}
                defaultValue={state.values.sku}
                id="product-sku"
                name="sku"
                placeholder="e.g. BODY-001"
              />
            </ProductField>
            <ProductField state={state} name="status" label="Visibility">
              <select
                className={inputClasses()}
                defaultValue={state.values.status || "draft"}
                id="product-status"
                name="status"
              >
                <option value="draft">Save as draft</option>
                <option value="active">Publish now</option>
              </select>
            </ProductField>
          </div>
        </section>

        <details className="group rounded-xl border border-line bg-raised">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[13.5px] font-bold text-ink marker:hidden">
            Media &amp; first variant
            <span aria-hidden="true" className="text-lg font-normal text-ink-muted transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="grid gap-4 border-t border-line-soft p-4">
            <ProductField state={state} name="productImage" label="Product photo" optional>
              <input
                accept="image/jpeg,image/png,image/webp"
                className="block w-full text-[13px] text-ink-soft file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line-strong file:bg-white file:px-3 file:py-2 file:text-[12.5px] file:font-semibold file:text-ink"
                id="product-productImage"
                onChange={handleImagePick}
                type="file"
              />
              {preparedImage ? (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-white p-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="Product preview" className="h-14 w-14 rounded-lg object-cover" src={preparedImage.dataUrl} />
                  <p className="text-[12.5px] text-ink-soft">Photo ready to upload.</p>
                </div>
              ) : null}
              {imageError ? <p className="mt-1.5 text-[13px] font-medium text-danger">{imageError}</p> : null}
              <input name="imageDataUrl" type="hidden" value={preparedImage?.dataUrl ?? ""} />
              <input name="imageWidth" type="hidden" value={preparedImage?.width ?? ""} />
              <input name="imageHeight" type="hidden" value={preparedImage?.height ?? ""} />
            </ProductField>
            <ProductField state={state} name="videoUrl" label="Product video link" optional>
              <input
                className={inputClasses(Boolean(fieldError(state, "videoUrl")))}
                defaultValue={state.values.videoUrl}
                id="product-videoUrl"
                name="videoUrl"
                placeholder="YouTube, TikTok or Instagram URL"
                type="url"
              />
            </ProductField>
            <div className="grid gap-3 rounded-xl border border-dashed border-line-strong bg-white p-4">
              <p className="text-[12.5px] font-bold text-ink">Optional first variant</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <input className={inputClasses()} defaultValue={state.values.variantName} name="variantName" placeholder="Name, e.g. Large" />
                <input className={inputClasses()} defaultValue={state.values.variantSku} name="variantSku" placeholder="Variant SKU" />
                <div>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[13px] font-semibold text-ink-muted">{symbol}</span>
                    <input className={inputClasses(false, "pl-12")} inputMode="decimal" min="0" onChange={(event) => setVariantPrice(event.target.value)} placeholder="Variant price" step={priceStep} type="number" value={variantPrice} />
                  </div>
                  <input name="variantPrice" type="hidden" value={majorToMinor(variantPrice, currency)} />
                </div>
                <input className={inputClasses()} defaultValue={state.values.variantStock} inputMode="numeric" min="0" name="variantStock" placeholder="Variant stock" step="1" type="number" />
              </div>
            </div>
          </div>
        </details>

        <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-3 border-t border-line bg-white/95 px-1 pt-4 backdrop-blur">
          <p className="mr-auto hidden text-[12px] text-ink-muted sm:block">Required: name, price and stock.</p>
          <Button className="min-w-32" disabled={pending} type="submit">
            {pending ? "Saving…" : "Save product"}
          </Button>
        </div>
      </form>

      {state.status === "success" && state.productId ? (
        <div className="rounded-xl border border-line bg-raised p-4">
          <ImageUploader productId={state.productId} />
        </div>
      ) : null}
    </div>
  );
}
