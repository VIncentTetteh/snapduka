"use client";

import { useState } from "react";

import {
  compressProductImage,
  validateProductImage,
} from "@/lib/catalog/images";

export function ImageUploader() {
  const [message, setMessage] = useState("Add images after saving the product.");

  return (
    <div className="grid gap-2 rounded-xl bg-stone-50 p-3">
      <label className="font-bold" htmlFor="product-image">Product image</label>
      <input
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        id="product-image"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const validation = validateProductImage(file);
          if (!validation.valid) {
            setMessage(validation.message);
            return;
          }
          try {
            const result = await compressProductImage(file);
            setMessage(`Ready to upload: ${Math.ceil(result.size / 1024)} KB WebP.`);
          } catch {
            setMessage("This browser could not prepare the image. Try another photo.");
          }
        }}
        type="file"
      />
      <p className="m-0 text-sm text-stone-600" role="status">{message}</p>
    </div>
  );
}
