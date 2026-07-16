"use client";

import { useState } from "react";

/**
 * Product photo gallery: main image as hero, thumbnails switch the hero.
 * Falls back to a warm gradient block when the product has no photos.
 */
export function ProductGallery({
  images,
  productName,
  fallbackGradient,
}: {
  images: string[];
  productName: string;
  fallbackGradient: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length === 0) {
    return (
      <span
        role="img"
        aria-label={`${productName} — photo coming soon`}
        className="block aspect-square rounded-[18px]"
        style={{ background: fallbackGradient }}
      />
    );
  }

  const active = images[Math.min(activeIndex, images.length - 1)];

  return (
    <div>
      {/* Seller-uploaded storage object */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={productName}
        src={active}
        className="block aspect-square w-full rounded-[18px] border border-line bg-white object-cover"
      />
      {images.length > 1 ? (
        <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Product photos">
          {images.map((url, index) => (
            <button
              key={url}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={`Photo ${index + 1} of ${images.length}`}
              onClick={() => setActiveIndex(index)}
              className={`h-14 w-14 flex-none cursor-pointer overflow-hidden rounded-[10px] bg-white p-0 ${
                index === activeIndex ? "border-2 border-accent" : "border border-line"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" src={url} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
