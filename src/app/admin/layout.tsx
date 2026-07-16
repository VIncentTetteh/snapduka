import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { resolveServerActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin");

  const admin = createAdminClient();
  const [{ count: pendingPayouts }, { count: openCases }] = await Promise.all([
    admin
      .from("payout_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "requested"),
    admin
      .from("support_cases")
      .select("id", { count: "exact", head: true })
      .in("status", ["opened", "seller_response_due", "under_review"]),
  ]);

  return (
    <div className="flex min-h-svh bg-paper text-ink">
      <AdminSidebar
        operatorName={actor.email ?? "Operator"}
        badges={{ payouts: pendingPayouts ?? 0, cases: openCases ?? 0 }}
      />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 border-b border-line bg-paper/94 backdrop-blur">
          <div className="flex h-[56px] items-center justify-between gap-3 px-4 sm:px-6">
            <p className="text-[13px] font-semibold text-ink-soft">Operations console</p>
            <span className="rounded-full bg-danger-tint px-3 py-1 text-[11.5px] font-bold uppercase tracking-wide text-danger">
              Production
            </span>
          </div>
        </header>
        <div className="pb-12">{children}</div>
      </div>
    </div>
  );
}
