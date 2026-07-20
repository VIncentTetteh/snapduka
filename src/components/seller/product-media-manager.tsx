import {
  deleteProductImageAction,
  setMainImageAction,
} from "@/app/(seller)/dashboard/products/actions";
import { ImageUploader } from "@/components/seller/image-uploader";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { publicMediaUrl } from "@/lib/storefront/media";

type MediaItem = {
  id: string;
  object_path: string;
  position: number;
};

/**
 * Product photo management: existing images (main first) with make-main and
 * remove controls, plus the upload zone for adding more.
 */
export function ProductMediaManager({
  productId,
  media,
}: {
  productId: string;
  media: MediaItem[];
}) {
  const sorted = media.slice().sort((a, b) => a.position - b.position);

  return (
    <div className="grid gap-4">
      {sorted.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {sorted.map((item, index) => {
            const url = publicMediaUrl(item.object_path);
            if (!url) return null;
            const isMain = index === 0;
            return (
              <figure key={item.id} className="m-0">
                <div className="relative">
                  {/* Seller-uploaded storage object */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={isMain ? "Main product photo" : `Product photo ${index + 1}`}
                    className={`aspect-square w-full rounded-xl object-cover ${
                      isMain ? "border-2 border-accent" : "border border-line"
                    }`}
                  />
                  {isMain ? (
                    <span className="absolute left-2 top-2">
                      <Badge tone="accent">Main image</Badge>
                    </span>
                  ) : null}
                </div>
                <figcaption className="mt-2 flex flex-wrap gap-1.5">
                  {!isMain ? (
                    <form action={setMainImageAction}>
                      <input name="productId" type="hidden" value={productId} />
                      <input name="mediaId" type="hidden" value={item.id} />
                      <SubmitButton
                        className="min-h-8 cursor-pointer rounded-lg border border-line-strong bg-white px-2.5 text-[12px] font-semibold text-ink transition-colors hover:border-[#B9AC98] disabled:cursor-wait disabled:opacity-60"
                        pendingLabel="Setting…"
                      >
                        Make main
                      </SubmitButton>
                    </form>
                  ) : null}
                  <form action={deleteProductImageAction}>
                    <input name="productId" type="hidden" value={productId} />
                    <input name="mediaId" type="hidden" value={item.id} />
                    <SubmitButton
                      className="min-h-8 cursor-pointer rounded-lg border border-danger-line bg-white px-2.5 text-[12px] font-semibold text-danger transition-colors hover:bg-danger-tint disabled:cursor-wait disabled:opacity-60"
                      pendingLabel="Removing…"
                    >
                      Remove
                    </SubmitButton>
                  </form>
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : (
        <p className="m-0 rounded-xl border border-warn-line bg-warn-tint px-3.5 py-3 text-[13px] leading-[1.55] text-warn">
          No photos yet — products with photos sell far better. The first image is what
          customers see in your storefront grid.
        </p>
      )}
      <ImageUploader productId={productId} />
    </div>
  );
}
