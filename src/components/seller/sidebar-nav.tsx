"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { LogoMark } from "@/components/ui/logo";

function StrokeIcon({ d }: { d: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type NavItem = {
  href: string;
  label: string;
  exact?: boolean;
  icon: ReactNode;
};

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        exact: true,
        icon: <StrokeIcon d="M3.5 10 10 3.5 16.5 10M5 8.8V16h3.5v-4h3v4H15V8.8" />,
      },
    ],
  },
  {
    label: "Sell",
    items: [
      {
        href: "/dashboard/payouts",
        label: "Balance & payouts",
        icon: <StrokeIcon d="M3 6.5h14v9H3v-9Zm0 3h14M6 12.5h3" />,
      },
      {
        href: "/dashboard/orders",
        label: "Orders",
        icon: <StrokeIcon d="M4 5h12l-1 9.5H5L4 5Zm0 0-.5-2H2m6 13.5a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0Zm7 0a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0Z" />,
      },
      {
        href: "/dashboard/products",
        label: "Products",
        icon: <StrokeIcon d="M4 6.5 10 3l6 3.5v7L10 17l-6-3.5v-7Zm0 0L10 10m0 0 6-3.5M10 10v7" />,
      },
      {
        href: "/dashboard/customers",
        label: "Customers",
        icon: <StrokeIcon d="M13.5 6a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM3.5 17c.6-3 3.2-4.5 6.5-4.5s5.9 1.5 6.5 4.5" />,
      },
    ],
  },
  {
    label: "Grow",
    items: [
      {
        href: "/dashboard/share",
        label: "Share Studio",
        icon: <StrokeIcon d="M13.5 6.5 6.8 9.6m0 .9 6.7 3M16 5a2.2 2.2 0 1 1-4.4 0A2.2 2.2 0 0 1 16 5ZM8.4 10a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Zm7.6 5a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z" />,
      },
      {
        href: "/dashboard/growth",
        label: "Growth",
        icon: <StrokeIcon d="M3.5 16.5v-13M3.5 16.5h13M7 13.5v-3m3.5 3v-6m3.5 6v-4.5" />,
      },
    ],
  },
  {
    label: "Configure",
    items: [
      {
        href: "/dashboard/settings",
        label: "Settings",
        icon: <StrokeIcon d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm6.5-2.5a6.4 6.4 0 0 0-.1-1.2l1.9-1.5-1.7-3-2.3.9a6.5 6.5 0 0 0-2-1.2L11.9 1.5H8.1L7.7 4a6.5 6.5 0 0 0-2 1.2l-2.3-.9-1.7 3 1.9 1.5a6.4 6.4 0 0 0 0 2.4l-1.9 1.5 1.7 3 2.3-.9a6.5 6.5 0 0 0 2 1.2l.4 2.5h3.8l.4-2.5a6.5 6.5 0 0 0 2-1.2l2.3.9 1.7-3-1.9-1.5c.07-.4.1-.8.1-1.2Z" />,
      },
    ],
  },
];

export function SidebarNav({ shopName }: { shopName: string; isVerified?: boolean }) {
  const pathname = usePathname();

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <aside className="sticky top-0 hidden h-svh w-60 flex-col self-start border-r border-line bg-raised md:flex">
      {/* Brand */}
      <div className="border-b border-line px-4.5 pb-4 pt-5">
        <Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
          <LogoMark className="h-8 w-8 rounded-[9px] text-[17px]" />
          <span className="text-[17px] font-bold tracking-[-0.02em] text-ink">SnapDuka</span>
        </Link>
        <p className="mt-2 truncate text-[12.5px] font-medium text-ink-muted">{shopName}</p>
      </div>

      {/* Grouped nav */}
      <nav aria-label="Seller navigation" className="flex-1 overflow-y-auto px-2.5 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1 px-2.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-faint">
              {group.label}
            </p>
            <div className="grid gap-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href, item.exact);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13.5px] no-underline transition-colors ${
                      active
                        ? "bg-accent-tint font-bold text-accent"
                        : "font-medium text-ink-soft hover:bg-line-soft hover:text-ink"
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Plan card */}
      <div className="px-3 pb-5 pt-2">
        <div className="rounded-[14px] border border-line bg-white px-3.5 py-3">
          <p className="text-[12px] font-bold text-accent">Free plan</p>
          <p className="mt-0.5 text-[11.5px] text-ink-muted">Unlimited products &amp; orders</p>
          <Link
            href="/dashboard/settings/billing"
            className="mt-2 block text-[11.5px] font-bold text-accent no-underline hover:text-accent-deep"
          >
            Upgrade →
          </Link>
        </div>
      </div>
    </aside>
  );
}
