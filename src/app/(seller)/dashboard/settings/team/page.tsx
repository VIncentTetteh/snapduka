import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

import { inviteTeamMember, revokeTeamMember } from "./actions";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const feedback = await searchParams;
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("team_memberships").select("id,email,role,active").eq("seller_account_id", actor.sellerAccountId),
    supabase.from("team_invitations").select("id,email,role,expires_at,accepted_at").eq("seller_account_id", actor.sellerAccountId),
  ]);

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Seller settings</p>
        <h1 className="page-title mt-1">Team</h1>
        <p className="page-sub">Only the owner can manage access. Revocation takes effect immediately.</p>
      </header>

      {feedback.error && <div className="alert alert-error" role="alert">{feedback.error}</div>}
      {feedback.message && <div className="alert alert-success" role="status">{feedback.message}</div>}

      {!actor.role && (
        <form action={inviteTeamMember} className="card grid gap-3">
          <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Invite a teammate</h2>
          <div className="grid gap-1">
            <label className="field-label" htmlFor="invite-email">Email<span aria-hidden="true" style={{ color: "var(--red)", fontWeight: 700 }}>*</span></label>
            <input aria-required="true" className="field-input" id="invite-email" name="email" placeholder="teammate@example.com" required type="email" />
          </div>
          <div className="grid gap-1">
            <label className="field-label" htmlFor="invite-role">Role</label>
            <select className="field-input" id="invite-role" name="role">
              <option>manager</option>
              <option>catalog</option>
              <option>fulfillment</option>
              <option>support</option>
              <option>analyst</option>
            </select>
          </div>
          <button className="btn-primary w-full" type="submit">Create invitation</button>
        </form>
      )}

      {members?.map((m) => (
        <article className="card" key={m.id}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="m-0 font-extrabold" style={{ color: "var(--ink)" }}>{m.email}</p>
              <p className="m-0 mt-0.5 text-sm capitalize" style={{ color: "var(--ink-2)" }}>{m.role}</p>
            </div>
            <span className={`badge ${m.active ? "badge-green" : "badge-stone"}`}>
              {m.active ? "Active" : "Revoked"}
            </span>
          </div>
          {m.active && !actor.role && (
            <form action={revokeTeamMember} className="mt-3">
              <input name="membershipId" type="hidden" value={m.id} />
              <button className="btn-danger text-sm" type="submit">Revoke access</button>
            </form>
          )}
        </article>
      ))}

      {invites?.map((i) => (
        <article
          className="rounded-xl px-4 py-3 text-sm"
          key={i.id}
          style={{ background: "var(--amber-lite)", border: "1px solid var(--border)" }}
        >
          <span className="font-semibold" style={{ color: "var(--ink)" }}>{i.email}</span>
          <span style={{ color: "var(--ink-2)" }}> · {i.role} · expires {new Date(i.expires_at).toLocaleDateString()}</span>
        </article>
      ))}
    </main>
  );
}
