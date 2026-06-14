import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { MobileNav } from "@/components/seller/mobile-nav";
import { resolveServerActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const actor = await resolveServerActor();
  if (actor.kind === "unprovisioned") redirect("/onboarding");
  if (actor.kind !== "seller") redirect("/login?next=/dashboard");
  return <><MobileNav />{children}</>;
}
