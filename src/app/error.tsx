"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="sd-main grid min-h-svh place-items-center bg-paper px-5 text-ink">
      <div className="w-full max-w-[440px] text-center">
        <span
          aria-hidden="true"
          className="mb-4 inline-grid h-12 w-12 place-items-center rounded-2xl bg-danger-tint"
        >
          <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path
              d="M9 6.5v3.2m0 2.6h.01M9 2 1.8 15h14.4L9 2Z"
              stroke="#B42318"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-danger">
          Something went wrong
        </p>
        <h1 className="mx-auto mb-3 max-w-none font-serif text-[clamp(26px,4vw,36px)] font-medium leading-[1.15] tracking-[-0.01em]">
          This screen could not load.
        </h1>
        <p className="mb-6 text-[14.5px] leading-[1.6] text-ink-soft">
          Nothing was lost. If you just placed an order or made a payment, check its receipt
          before retrying.
        </p>
        <button
          onClick={reset}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-[10px] border-none bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-deep"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
