import Link from "next/link";

export default function StorefrontNotFound() {
  return (
    <main className="sd-main grid min-h-svh place-items-center bg-paper px-5 text-ink">
      <div className="w-full max-w-[440px] text-center">
        <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">
          Store unavailable
        </p>
        <h1 className="mx-auto mb-3 max-w-none font-serif text-[clamp(26px,4vw,36px)] font-medium leading-[1.15] tracking-[-0.01em]">
          This shop or product is not available.
        </h1>
        <p className="mb-6 text-[14.5px] leading-[1.6] text-ink-soft">
          It may be hidden, sold out elsewhere, or the link may be incorrect.
        </p>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-[10px] bg-accent px-5 text-[14px] font-semibold text-white no-underline transition-colors hover:bg-accent-deep"
        >
          Return to SnapDuka
        </Link>
      </div>
    </main>
  );
}
