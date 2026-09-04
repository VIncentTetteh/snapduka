"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { uploadCampaignCreative } from "@/app/(seller)/dashboard/growth/campaigns/campaign-actions";
import { compressProductImage, validateProductImage } from "@/lib/catalog/images";

/**
 * The campaign's creative.
 *
 * Same shape as the shop logo uploader: validate, compress in the browser, send
 * a data URL to a server action that writes it under the seller's own storage
 * folder. Compressing client-side matters more here than anywhere — sellers
 * upload straight from a phone camera, and a 6 MB original would be refused by
 * the bucket's size limit.
 */
export function CampaignCreativeUploader({
  campaignId,
  hasCreative,
}: {
  campaignId: string;
  hasCreative: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "working" | "error" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const validation = validateProductImage(file);
    if (!validation.valid) {
      setStatus("error");
      setMessage(validation.message);
      return;
    }

    setStatus("working");
    setMessage("Uploading…");
    try {
      const compressed = await compressProductImage(file);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(compressed);
      });

      const result = await uploadCampaignCreative(campaignId, dataUrl);
      setStatus(result.success ? "done" : "error");
      setMessage(result.message);
      if (result.success) router.refresh();
    } catch {
      setStatus("error");
      setMessage("Could not prepare that image. Try another file.");
    }
  }

  return (
    <div className="grid gap-2">
      <p className="m-0 text-[13px] text-ink-soft">
        {hasCreative
          ? "This image is the campaign's cover and goes on the card you post."
          : "Add an image to use as this campaign's cover and on the card you post."}
      </p>
      <label className="btn-secondary w-fit cursor-pointer">
        {status === "working" ? "Uploading…" : hasCreative ? "Replace image" : "Add image"}
        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={status === "working"}
          onChange={handleFile}
          type="file"
        />
      </label>
      {message ? (
        <p
          className={`m-0 text-[12.5px] ${status === "error" ? "font-medium text-danger" : "text-ink-muted"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
