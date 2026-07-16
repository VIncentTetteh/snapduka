import Link from "next/link";

import { appHost } from "@/lib/app-url";

import { InitialsAvatar } from "@/components/ui/gradient-placeholder";
import { LogoMark } from "@/components/ui/logo";

/** Top bar of the seller app: store-link pill, notifications, avatar. */
export async function DashboardHeader({
  slug,
  isPublished,
  ownerName,
}: {
  slug: string | null;
  isPublished: boolean;
  ownerName: string;
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
        <Link
          href="/dashboard/settings/notifications"
          aria-label="Notifications"
          className="relative grid h-10 w-10 place-items-center rounded-[10px] border border-line-input bg-white text-ink-soft no-underline transition-colors hover:bg-line-soft"
        >
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 2.5a5 5 0 0 0-5 5v3l-1.5 3h13L15 10.5v-3a5 5 0 0 0-5-5Zm-1.8 11.8a1.8 1.8 0 0 0 3.6 0"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <Link
          href="/dashboard/settings"
          aria-label="Account settings"
          className="no-underline"
        >
          <InitialsAvatar name={ownerName} className="h-10 w-10 text-[13px]" />
        </Link>
      </div>
    </header>
  );
}
