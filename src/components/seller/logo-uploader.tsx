"use client";

import { useState } from "react";

import {
  removeShopLogoAction,
  uploadShopLogoAction,
} from "@/app/(seller)/dashboard/settings/branding/actions";
import { compressProductImage, validateProductImage } from "@/lib/catalog/images";

/** Optional shop logo: preview, upload, replace, remove. */
export function LogoUploader({ currentLogoUrl }: { currentLogoUrl: string | null }) {
  const [status, setStatus] = useState<"idle" | "ready" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ height: 0, width: 0 });

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const validation = validateProductImage(file);
    if (!validation.valid) {
      setStatus("error");
      setMessage(validation.message);
      return;
    }
    try {
      const compressed = await compressProductImage(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const image = new Image();
        image.onload = () =>
          setDimensions({ height: image.naturalHeight, width: image.naturalWidth });
        image.src = dataUrl;
        setPreviewUrl(dataUrl);
        setStatus("ready");
        setMessage(`Ready — ${Math.ceil(compressed.size / 1024)} KB`);
      };
      reader.readAsDataURL(compressed);
    } catch {
      setStatus("error");
      setMessage("Could not prepare the image. Try another file.");
    }
  }

  async function handleUpload() {
    if (!previewUrl) return;
    setStatus("uploading");
    setMessage("Uploading…");
    const result = await uploadShopLogoAction(previewUrl, dimensions);
    setStatus(result.success ? "done" : "error");
    setMessage(result.message);
  }

  const displayUrl = previewUrl ?? currentLogoUrl;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-4">
        {displayUrl ? (
          // Seller-uploaded storage object
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt="Shop logo"
            src={displayUrl}
            className="h-16 w-16 rounded-full border border-line bg-white object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-16 w-16 place-items-center rounded-full bg-[linear-gradient(135deg,#D9C6A8,#A8875D)] text-[11px] font-semibold text-white"
          >
            No logo
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold" style={{ color: "var(--ink)" }}>
            Shop logo <span className="font-normal" style={{ color: "var(--ink-3)" }}>(optional)</span>
          </p>
          <p className="m-0 mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>
            Shown on your storefront header. Square works best — JPEG, PNG or WebP.
          </p>
        </div>
      </div>

      <input
        accept="image/jpeg,image/png,image/webp"
        aria-label="Upload shop logo"
        className="text-sm"
        onChange={handleFile}
        style={{ color: "var(--ink-2)" }}
        type="file"
      />

      {message ? (
        <p
          role="status"
          className={`m-0 text-sm ${status === "error" ? "field-error" : ""}`}
          style={status !== "error" ? { color: "var(--ink-3)" } : undefined}
        >
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {status === "ready" && previewUrl ? (
          <button
            className="btn-primary"
            disabled={!dimensions.width || !dimensions.height}
            onClick={handleUpload}
            type="button"
          >
            Save logo
          </button>
        ) : null}
        {currentLogoUrl && status !== "uploading" ? (
          <button
            className="btn-danger"
            onClick={async () => {
              await removeShopLogoAction();
              setPreviewUrl(null);
              setStatus("idle");
              setMessage("Logo removed.");
            }}
            type="button"
          >
            Remove logo
          </button>
        ) : null}
      </div>
    </div>
  );
}
