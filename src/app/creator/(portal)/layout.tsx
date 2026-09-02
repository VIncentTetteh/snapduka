import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { LogoMark } from "@/components/ui/logo";
import { resolveCreatorContext, resolveServerActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/creator", label: "Earnings", exact: true },
  { href: "/creator/links", label: "My links" },
  { href: "/creator/payments", label: "Payments" },
  { href: "/creator/partners", label: "Shops" },
  { href: "/creator/settings", label: "Settings" },
];

/**
 * Creator portal shell. Deliberately not the seller SidebarNav — a creator is
 * a different person with a different job, and reusing the seller chrome would
 * imply access they do not have.
 *
 * Scoped to the (portal) group on purpose. /creator/start and
 * /creator/invitations/[token] sit OUTSIDE it: the invitation page must show
 * the offer before anyone signs in, and putting /creator/start behind a guard
 * that redirects to /creator/start is an infinite loop.
 */
export default async function CreatorLayout({ children }: { children: ReactNode }) {
  const [actor, creator] = await Promise.all([resolveServerActor(), resolveCreatorContext()]);

  if (!actor.authenticated) redirect("/login?next=/creator");
  if (actor.kind === "operator") redirect("/admin");
  // Gated on the creator profile, not on the actor kind. A shop owner promoting
  // someone else's shop resolves as a seller and still belongs here.
  if (!creator) redirect("/creator/start");
  // Shown only when they have somewhere to switch back to.
  const alsoSeller = actor.kind === "seller";

  return (
    <div className="flex min-h-svh flex-col bg-paper text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/94 backdrop-blur">
        <div className="mx-auto flex h-[60px] max-w-[900px] items-center gap-3 px-4 sm:px-6">
          <Link href="/creator" className="flex items-center gap-2 no-underline">
            <LogoMark className="h-7 w-7 rounded-lg text-[15px]" />
            <span className="text-[15px] font-bold tracking-[-0.02em] text-ink">SnapDuka</span>
          </Link>
          <span className="rounded-full bg-accent-tint px-2.5 py-0.5 text-[11px] font-bold text-accent">
            Creator
          </span>
          <div className="flex-1" />
          <span className="hidden truncate text-[12.5px] font-semibold text-ink-soft sm:block">
            @{creator.handle}
          </span>
        </div>
        <nav aria-label="Creator navigation" className="mx-auto flex max-w-[900px] gap-1 overflow-x-auto px-4 sm:px-6">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 pb-2.5 pt-1 text-[13.5px] font-semibold text-ink-muted no-underline hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
          {/* Only rendered for someone who also owns a shop, so the two
              contexts on one account stay reachable from each other. */}
          {alsoSeller ? (
            <Link
              href="/dashboard"
              className="-mb-px ml-auto whitespace-nowrap border-b-2 border-transparent px-3 pb-2.5 pt-1 text-[13.5px] font-semibold text-accent no-underline hover:text-accent-deep"
            >
              My shop →
            </Link>
          ) : null}
        </nav>
      </header>
      <div className="mx-auto w-full max-w-[900px] flex-1 px-4 pb-16 pt-6 sm:px-6">{children}</div>
    </div>
  );
}
