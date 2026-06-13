import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { resolveServerActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect("/login?next=/admin/cases");
  return <>{children}</>;
}
