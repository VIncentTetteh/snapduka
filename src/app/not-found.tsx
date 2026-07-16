import Link from "next/link";

import { LogoMark } from "@/components/ui/logo";

export default function NotFound() {
  return (
    <main className="sd-main grid min-h-svh place-items-center bg-paper px-5 text-ink">
      <div className="w-full max-w-[440px] text-center">
        <span className="mb-5 inline-block">
          <LogoMark className="h-11 w-11 rounded-xl text-[22px]" />
        </span>
        <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">
          Page not found
        </p>
        <h1 className="mx-auto mb-3 max-w-none font-serif text-[clamp(26px,4vw,36px)] font-medium leading-[1.15] tracking-[-0.01em]">
          This page doesn&rsquo;t exist — or it moved.
        </h1>
        <p className="mb-6 text-[14.5px] leading-[1.6] text-ink-soft">
          Check the link, or head back to somewhere familiar.
        </p>
        <div className="flex flex-wrap justify-center gap-2.5">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-[10px] bg-accent px-5 text-[14px] font-semibold text-white no-underline transition-colors hover:bg-accent-deep"
          >
            Go home
          </Link>
          <Link
            href="/discover"
            className="inline-flex min-h-11 items-center rounded-[10px] border border-line-strong bg-white px-5 text-[14px] font-semibold text-ink no-underline transition-colors hover:border-[#B9AC98]"
          >
            Discover stores
          </Link>
        </div>
      </div>
    </main>
  );
}
