import Link from "next/link";

import { appHost } from "@/lib/app-url";

import { AccountMenu } from "@/components/seller/account-menu";
import { NotificationsBell } from "@/components/seller/notifications-bell";
import { LogoMark } from "@/components/ui/logo";

/** Top bar of the seller app: store-link pill, notifications, account menu. */
export async function DashboardHeader({
  slug,
  isPublished,
  ownerName,
  shopName,
}: {
  slug: string | null;
  isPublished: boolean;
  ownerName: string;
  shopName: string;
}) {
  const host = await appHost();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/94 backdrop-blur">
      <div className="flex h-[60px] items-center gap-3 px-4 sm:px-6">
        <Link href="/dashboard" className="flex items-center gap-2 no-underline md:hidden">
          <LogoMark className="h-7 w-7 rounded-lg text-[15px]" />
        </Link>
        {slug ? (
          <a
            href={`/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="hidden min-h-9 items-center gap-2 rounded-full border border-line-input bg-white px-3.5 font-mono text-[12.5px] font-semibold text-ink-soft no-underline transition-colors hover:border-[#B9AC98] hover:text-ink sm:inline-flex"
          >
            <span
              aria-hidden="true"
              className={`inline-block h-1.5 w-1.5 rounded-full ${isPublished ? "bg-success" : "bg-warn"}`}
            />
            {host}/{slug}
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M5 2.5h6.5V9M11.5 2.5 6 8m-1.5-4H3A1.5 1.5 0 0 0 1.5 5.5v6A1.5 1.5 0 0 0 3 13h6a1.5 1.5 0 0 0 1.5-1.5V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        ) : null}
        <div className="flex-1" />
        <NotificationsBell />
        <AccountMenu ownerName={ownerName} shopName={shopName} />
      </div>
    </header>
  );
}
