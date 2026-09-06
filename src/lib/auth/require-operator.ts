import "server-only";

import { redirect } from "next/navigation";

import { resolveServerActor, type OperatorActor } from "@/lib/auth/actor";

/**
 * The operator check, in the handler rather than only in the layout.
 *
 * `admin/layout.tsx` redirects a non-operator, and until now that was the only
 * check on any admin page. Next's own guidance is that a layout is not an
 * authorization boundary: layouts do not re-run on every navigation, and a page
 * rendered outside the layout it appears to sit under would carry no check at
 * all.
 *
 * The stakes here are higher than on a seller page. Every admin page reads
 * through the service-role client, which bypasses RLS by design, so these pages
 * have no second line of defence — whatever the query asks for, it gets, for
 * every seller on the platform. Every other privileged surface in this codebase
 * re-checks in the handler; this brings the admin pages in line.
 */
export async function requireOperator(next = "/admin"): Promise<OperatorActor> {
  const actor = await resolveServerActor();
  if (actor.kind !== "operator") redirect(`/login?next=${encodeURIComponent(next)}`);
  return actor;
}
