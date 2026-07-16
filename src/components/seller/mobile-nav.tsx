"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function StrokeIcon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    exact: true,
    d: "M3.5 10 10 3.5 16.5 10M5 8.8V16h3.5v-4h3v4H15V8.8",
  },
  {
    href: "/dashboard/orders",
    label: "Orders",
    d: "M4 5h12l-1 9.5H5L4 5Zm0 0-.5-2H2m6 13.5a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0Zm7 0a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0Z",
  },
  {
    href: "/dashboard/products",
    label: "Products",
    d: "M4 6.5 10 3l6 3.5v7L10 17l-6-3.5v-7Zm0 0L10 10m0 0 6-3.5M10 10v7",
  },
  {
    href: "/dashboard/share",
    label: "Share",
    d: "M13.5 6.5 6.8 9.6m0 .9 6.7 3M16 5a2.2 2.2 0 1 1-4.4 0A2.2 2.2 0 0 1 16 5ZM8.4 10a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Zm7.6 5a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z",
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    d: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm6.5-2.5a6.4 6.4 0 0 0-.1-1.2l1.9-1.5-1.7-3-2.3.9a6.5 6.5 0 0 0-2-1.2L11.9 1.5H8.1L7.7 4a6.5 6.5 0 0 0-2 1.2l-2.3-.9-1.7 3 1.9 1.5a6.4 6.4 0 0 0 0 2.4l-1.9 1.5 1.7 3 2.3-.9a6.5 6.5 0 0 0 2 1.2l.4 2.5h3.8l.4-2.5a6.5 6.5 0 0 0 2-1.2l2.3.9 1.7-3-1.9-1.5c.07-.4.1-.8.1-1.2Z",
  },
] as const;

/** Fixed bottom tab bar for the seller app on small screens. */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Seller navigation"
      className="fixed inset-x-0 bottom-0 z-50 flex border-t border-line bg-raised/97 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {ITEMS.map((item) => {
        const active =
          "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[10.5px] no-underline ${
              active ? "font-bold text-accent" : "font-semibold text-ink-muted"
            }`}
          >
            <StrokeIcon d={item.d} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
