import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardHeader } from "@/components/seller/dashboard-header";
import { MobileNav } from "@/components/seller/mobile-nav";
import { SidebarNav } from "@/components/seller/sidebar-nav";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const actor = await resolveServerActor();
  if (actor.kind === "unprovisioned") redirect("/onboarding");
  if (actor.kind !== "seller") redirect("/login?next=/dashboard");

  const supabase = await createClient();
  const [{ data: shop }, { data: account }] = await Promise.all([
    supabase
      .from("shops")
      .select("display_name, slug, status")
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    supabase
      .from("seller_accounts")
      .select("contact_name")
      .eq("id", actor.sellerAccountId)
      .maybeSingle(),
  ]);

  const shopName = shop?.display_name ?? "SnapDuka";
  const ownerName = account?.contact_name ?? shopName;

  return (
    <div className="flex min-h-svh bg-paper text-ink">
      <SidebarNav shopName={shopName} />
      <div className="min-w-0 flex-1">
        <DashboardHeader
          isPublished={shop?.status === "published"}
          ownerName={ownerName}
          slug={shop?.slug ?? null}
        />
        <div className="pb-24 md:pb-8">{children}</div>
        <MobileNav />
      </div>
    </div>
  );
}
