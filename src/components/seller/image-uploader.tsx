"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { uploadProductImageAction } from "@/app/(seller)/dashboard/products/actions";
import { compressProductImage, validateProductImage } from "@/lib/catalog/images";

type PreparedImage = {
  dataUrl: string;
  width: number;
  height: number;
  sizeKb: number;
};

function prepareImage(file: File): Promise<PreparedImage> {
  return new Promise((resolve, reject) => {
    compressProductImage(file)
      .then((compressed) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("read failed"));
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          const image = new Image();
          image.onerror = () => reject(new Error("decode failed"));
          image.onload = () =>
            resolve({
              dataUrl,
              width: image.naturalWidth,
              height: image.naturalHeight,
              sizeKb: Math.ceil(compressed.size / 1024),
            });
          image.src = dataUrl;
        };
        reader.readAsDataURL(compressed);
      })
      .catch(reject);
  });
}

/** Multi-file product photo uploader: pick several, review, upload in order. */
export function ImageUploader({ productId }: { productId: string }) {
  const router = useRouter();
  const [prepared, setPrepared] = useState<PreparedImage[]>([]);
  const [status, setStatus] = useState<"idle" | "preparing" | "ready" | "uploading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    setStatus("preparing");
    setMessage("Preparing…");
    const next: PreparedImage[] = [];
    for (const file of files) {
      const validation = validateProductImage(file);
      if (!validation.valid) {
        setStatus("error");
        setMessage(`${file.name}: ${validation.message}`);
        return;
      }
      try {
        next.push(await prepareImage(file));
      } catch {
        setStatus("error");
        setMessage(`${file.name}: could not prepare this image. Try another photo.`);
        return;
      }
    }
    setPrepared(next);
    setStatus("ready");
    const totalKb = next.reduce((sum, image) => sum + image.sizeKb, 0);
    setMessage(
      `Ready — ${next.length} ${next.length === 1 ? "photo" : "photos"} · ${totalKb} KB`,
    );
  }

  async function handleUpload() {
    if (prepared.length === 0) return;
    setStatus("uploading");
    for (const [index, image] of prepared.entries()) {
      setMessage(`Uploading ${index + 1} of ${prepared.length}…`);
      const result = await uploadProductImageAction(productId, image.dataUrl, {
        height: image.height,
        width: image.width,
      });
      if (!result.success) {
        setStatus("error");
        setMessage(`Photo ${index + 1}: ${result.message}`);
        setPrepared(prepared.slice(index));
        router.refresh();
        return;
      }
    }
    setPrepared([]);
    setStatus("idle");
    setMessage("Photos saved.");
    router.refresh();
  }

  return (
    <div
      className="grid gap-3 rounded-2xl p-4"
      style={{ background: "var(--surface)", border: "1.5px dashed var(--border)" }}
    >
      <label className="field-label" htmlFor="product-image">
        Add photos{" "}
        <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>
          (JPEG · PNG · WebP · select several at once)
        </span>
      </label>

      {prepared.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {prepared.map((image, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              alt={`Photo ${index + 1} preview`}
              src={image.dataUrl}
              className="h-20 w-20 rounded-xl border object-cover"
              style={{ borderColor: "var(--border)" }}
            />
          ))}
        </div>
      )}

      <input
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="text-sm"
        disabled={status === "uploading" || status === "preparing"}
        id="product-image"
        multiple
        onChange={handleFiles}
        style={{ color: "var(--ink-2)" }}
        type="file"
      />

      {message && (
        <p
          className={`m-0 text-sm ${status === "error" ? "field-error" : ""}`}
          role="status"
          style={status !== "error" ? { color: "var(--ink-3)" } : undefined}
        >
          {message}
        </p>
      )}

      {status === "ready" && prepared.length > 0 && (
        <button className="btn-primary w-full" onClick={handleUpload} type="button">
          Upload {prepared.length} {prepared.length === 1 ? "photo" : "photos"}
        </button>
      )}
    </div>
  );
}
