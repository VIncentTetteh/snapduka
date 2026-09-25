import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { BrandLink } from "@/components/ui/logo";
import { isBuyerAccountsEnabled } from "@/lib/buyer/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My SnapDuka",
  // Personal pages: nothing here is for search engines.
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/me", label: "Account" },
  { href: "/me/orders", label: "Orders" },
  { href: "/me/addresses", label: "Addresses" },
  { href: "/me/privacy", label: "Privacy" },
] as const;

/**
 * Buyer area. While `buyer_accounts` is off every /me route is a 404, so the
 * feature cannot be found (or crawled) before it is launched.
 */
export default async function BuyerLayout({ children }: { children: ReactNode }) {
  if (!(await isBuyerAccountsEnabled())) notFound();

  return (
    <main className="sd-main min-h-svh bg-paper text-ink">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-[720px] flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <BrandLink />
          <nav aria-label="My SnapDuka" className="flex flex-wrap gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-[9px] px-3 py-1.5 text-[13.5px] font-semibold text-ink-soft hover:bg-line-soft hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-[720px] px-4 pb-16 pt-6">{children}</div>
    </main>
  );
}
