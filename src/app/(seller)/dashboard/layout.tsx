import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardHeader } from "@/components/seller/dashboard-header";
import { MobileNav } from "@/components/seller/mobile-nav";
import { SidebarNav } from "@/components/seller/sidebar-nav";
import { resolveCreatorContext, resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const actor = await resolveServerActor();
  if (actor.kind === "unprovisioned") redirect("/onboarding");
  // Without this a signed-in creator is bounced to /login, which then signs
  // them straight back in — a loop rather than a redirect.
  if (actor.kind === "creator") redirect("/creator");
  if (actor.kind !== "seller") redirect("/login?next=/dashboard");

  const supabase = await createClient();
  const [{ data: shop }, { data: account }, plan] = await Promise.all([
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
    getSellerPlan(actor.sellerAccountId),
  ]);

  // A shop owner can also hold a creator profile for someone else's shop; the
  // nav link is the only way back to it, since they always resolve as a seller.
  const isCreator = Boolean(await resolveCreatorContext());

  const shopName = shop?.display_name ?? "SnapDuka";
  const ownerName = account?.contact_name ?? shopName;

  return (
    <div className="flex min-h-svh bg-paper text-ink">
      <SidebarNav shopName={shopName} planName={plan.planName} planCode={plan.planCode} isCreator={isCreator} />
      <div className="min-w-0 flex-1">
        <DashboardHeader
          isPublished={shop?.status === "published"}
          ownerName={ownerName}
          shopName={shopName}
          slug={shop?.slug ?? null}
        />
        <div className="pb-24 md:pb-8">{children}</div>
        <MobileNav />
      </div>
    </div>
  );
}
