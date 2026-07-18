"use client";

import { useState } from "react";

import { buildEmbedUrl, type VideoProvider } from "@/lib/catalog/video";

export type VideoSlide = {
  provider: VideoProvider;
  videoId: string | null;
  videoUrl: string;
  thumbnailUrl: string | null;
};

/**
 * Product gallery: an optional video as the first slide, then photos.
 * Falls back to a warm gradient block when the product has no media at all.
 */
export function ProductGallery({
  images,
  video,
  productName,
  fallbackGradient,
}: {
  images: string[];
  video?: VideoSlide | null;
  productName: string;
  fallbackGradient: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const hasVideo = Boolean(video);
  const totalSlides = images.length + (hasVideo ? 1 : 0);

  if (totalSlides === 0) {
    return (
      <span
        role="img"
        aria-label={`${productName} — photo coming soon`}
        className="block aspect-square rounded-[18px]"
        style={{ background: fallbackGradient }}
      />
    );
  }

  const isVideoSlide = hasVideo && activeIndex === 0;
  const activeImageUrl = isVideoSlide
    ? null
    : images[Math.min(activeIndex - (hasVideo ? 1 : 0), images.length - 1)];
  const embedUrl = video && video.videoId ? buildEmbedUrl(video.provider, video.videoId) : null;

  function selectSlide(index: number) {
    setPlaying(false);
    setActiveIndex(index);
  }

  function handleVideoTap() {
    if (!video) return;
    if (embedUrl) {
      setPlaying(true);
      return;
    }
    window.open(video.videoUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div>
      {isVideoSlide && video ? (
        playing && embedUrl ? (
          <iframe
            src={embedUrl}
            title={`${productName} video`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="block aspect-square w-full rounded-[18px] border border-line bg-black"
          />
        ) : (
          <button
            type="button"
            onClick={handleVideoTap}
            aria-label={`Play video for ${productName}`}
            className="relative block aspect-square w-full cursor-pointer overflow-hidden rounded-[18px] border border-line bg-ink p-0"
          >
            {video.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={video.thumbnailUrl} className="h-full w-full object-cover opacity-80" />
            ) : null}
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 text-ink">
                <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M6 4.5v11l9-5.5-9-5.5Z" />
                </svg>
              </span>
            </span>
          </button>
        )
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={productName}
          src={activeImageUrl ?? undefined}
          className="block aspect-square w-full rounded-[18px] border border-line bg-white object-cover"
        />
      )}
      {totalSlides > 1 ? (
        <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Product media">
          {hasVideo && video ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeIndex === 0}
              aria-label="Video"
              onClick={() => selectSlide(0)}
              className={`relative h-14 w-14 flex-none cursor-pointer overflow-hidden rounded-[10px] bg-ink p-0 ${
                activeIndex === 0 ? "border-2 border-accent" : "border border-line"
              }`}
            >
              {video.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={video.thumbnailUrl} className="h-full w-full object-cover opacity-70" />
              ) : null}
              <span className="absolute inset-0 grid place-items-center text-white">▶</span>
            </button>
          ) : null}
          {images.map((url, index) => {
            const slideIndex = index + (hasVideo ? 1 : 0);
            return (
              <button
                key={url}
                type="button"
                role="tab"
                aria-selected={slideIndex === activeIndex}
                aria-label={`Photo ${index + 1} of ${images.length}`}
                onClick={() => selectSlide(slideIndex)}
                className={`h-14 w-14 flex-none cursor-pointer overflow-hidden rounded-[10px] bg-white p-0 ${
                  slideIndex === activeIndex ? "border-2 border-accent" : "border border-line"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src={url} className="h-full w-full object-cover" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
