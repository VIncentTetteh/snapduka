export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-lg bg-line motion-safe:animate-sd-pulse ${className}`}
    />
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="h-9 w-9 rounded-[9px]" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  );
}
