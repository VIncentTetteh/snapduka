"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutForm } from "@/components/ui/sign-out-form";

function StrokeIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ITEMS = [
  {
    href: "/admin",
    label: "Overview",
    exact: true,
    d: "M3.5 10 10 3.5 16.5 10M5 8.8V16h3.5v-4h3v4H15V8.8",
    badgeKey: null,
  },
  {
    href: "/admin/payouts",
    label: "Payout approvals",
    d: "M3 6.5h14v9H3v-9Zm0 3h14M6 12.5h3",
    badgeKey: "payouts" as const,
  },
  {
    href: "/admin/sellers",
    label: "Sellers",
    d: "M13.5 6a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM3.5 17c.6-3 3.2-4.5 6.5-4.5s5.9 1.5 6.5 4.5",
    badgeKey: null,
  },
  {
    href: "/admin/products",
    label: "Products",
    d: "M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5v-7ZM10 3v14M3.5 6.5 10 10l6.5-3.5",
    badgeKey: null,
  },
  {
    href: "/admin/cases",
    label: "Cases",
    d: "M10 2.5a7.5 7.5 0 0 0-6.4 11.4L2.5 17.5l3.7-1A7.5 7.5 0 1 0 10 2.5Z",
    badgeKey: "cases" as const,
  },
  {
    href: "/admin/creators",
    label: "Creators",
    d: "M12.5 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm4.5 10c-.4-2.3-2.6-3.5-5-3.5m-7 3.5c.4-2.3 2.6-3.5 5-3.5M16 8.5a1.8 1.8 0 1 1-3.5 0 1.8 1.8 0 0 1 3.5 0Z",
    badgeKey: null,
  },
  {
    href: "/admin/plans",
    label: "Plans & fees",
    d: "M4 4.5h12v11H4v-11Zm0 3.5h12M7.5 11.5h5",
    badgeKey: null,
  },
  {
    href: "/admin/audit",
    label: "Audit log",
    d: "M6 3h8a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 14 17H6a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 6 3Zm1.5 4.5h5m-5 3h5m-5 3h3",
    badgeKey: null,
  },
];

export function AdminSidebar({
  operatorName,
  badges,
}: {
  operatorName: string;
  badges: { payouts: number; cases: number };
}) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-svh w-60 flex-col self-start bg-ink text-paper md:flex">
      {/* Brand */}
      <div className="border-b border-paper/12 px-4.5 pb-4 pt-5">
        <Link href="/admin" className="flex items-center gap-2.5 no-underline">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 place-items-center rounded-[9px] bg-accent font-serif text-[17px] font-bold text-white"
          >
            S
          </span>
          <span>
            <span className="block text-[15px] font-bold tracking-[-0.01em] text-paper">
              SnapDuka
            </span>
            <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#B8AEA1]">
              Operations
            </span>
          </span>
        </Link>
      </div>

      {/* Nav */}
      <nav aria-label="Operator navigation" className="flex-1 overflow-y-auto px-2.5 py-3">
        <div className="grid gap-0.5">
          {ITEMS.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const badge = item.badgeKey ? badges[item.badgeKey] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13.5px] no-underline transition-colors ${
                  active
                    ? "bg-paper/12 font-bold text-paper"
                    : "font-medium text-[#B8AEA1] hover:bg-paper/8 hover:text-paper"
                }`}
              >
                <StrokeIcon d={item.d} />
                <span className="flex-1">{item.label}</span>
                {badge > 0 ? (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-bold text-white">
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Operator */}
      <div className="border-t border-paper/12 px-4.5 py-4">
        <p className="truncate text-[12.5px] font-semibold text-paper">{operatorName}</p>
        <p className="text-[11px] text-[#B8AEA1]">Operator</p>
        <SignOutForm className="mt-2.5 w-full cursor-pointer rounded-[8px] border border-paper/20 bg-transparent px-2.5 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:bg-paper/10" />
      </div>
    </aside>
  );
}
