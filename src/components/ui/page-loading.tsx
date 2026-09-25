import { Skeleton, SkeletonRow } from "./skeleton";
import { Spinner } from "./spinner";

/**
 * What a page shows while its data loads, in the shape of the page that is
 * coming — so the layout does not jump when it arrives — with a spoken
 * "Loading …" for screen readers. Used by the route segments' loading.tsx.
 */

type Variant = "list" | "detail" | "shop" | "centered";

export function PageLoading({ variant = "list", label = "Loading" }: { variant?: Variant; label?: string }) {
  if (variant === "centered") {
    return (
      <div className="grid min-h-[60svh] place-items-center text-accent">
        <div className="grid justify-items-center gap-3">
          <Spinner size={28} />
          <p className="m-0 text-[13.5px] text-ink-muted">{label}…</p>
        </div>
      </div>
    );
  }

  return (
    <div aria-busy="true" className="mx-auto w-full max-w-[1040px] px-4 py-6 sm:px-6">
      <p className="mb-5 flex items-center gap-2 text-[13px] text-ink-muted" role="status">
        <Spinner size={14} className="text-accent" />
        {label}…
      </p>
      {variant === "list" ? (
        <>
          <Skeleton className="mb-5 h-8 w-56" />
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        </>
      ) : null}
      {variant === "detail" ? (
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <div className="grid gap-4">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-44" />
            <Skeleton className="h-28" />
          </div>
          <div className="grid gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-24" />
          </div>
        </div>
      ) : null}
      {variant === "shop" ? (
        <>
          <div className="mb-6 flex items-center gap-3">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-square w-full rounded-xl" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
