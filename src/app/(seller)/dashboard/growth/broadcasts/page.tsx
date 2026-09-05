import { ActionBanner } from "@/components/ui/action-banner";
import { UpgradePrompt } from "@/components/seller/upgrade-prompt";
import { resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan, planLimit } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";

import { cancelBroadcast, createBroadcast, scheduleBroadcast } from "./actions";

export default async function BroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const banner = await searchParams;
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [{ data }, { data: segments }, plan, { count: usedThisMonth }] = await Promise.all([
    supabase.from("marketing_broadcasts").select("id,channel,subject,body,state,scheduled_at,created_at,marketing_deliveries(state)").eq("seller_account_id", actor.sellerAccountId).order("created_at", { ascending: false }),
    supabase.from("customer_segments").select("id,name").eq("seller_account_id", actor.sellerAccountId).order("name"),
    getSellerPlan(actor.sellerAccountId),
    supabase.from("marketing_broadcasts").select("id", { count: "exact", head: true }).eq("seller_account_id", actor.sellerAccountId).gte("created_at", monthStart.toISOString()),
  ]);
  const monthlyLimit = planLimit(plan, "broadcastsPerMonth");
  const quotaLeft = monthlyLimit - (usedThisMonth ?? 0);

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-16">
      <ActionBanner error={banner.error} saved={banner.saved ? "Saved." : undefined} />

      <header>
        <p className="page-eyebrow m-0">Growth</p>
        <h1 className="page-title mt-1">Broadcasts</h1>
        <p className="page-sub">Recipients are rechecked for consent and frequency limits when delivery begins.</p>
      </header>

      {monthlyLimit === 0 ? (
        <UpgradePrompt feature="Broadcasts" planName={plan.planName} />
      ) : quotaLeft <= 0 ? (
        <UpgradePrompt
          feature="Broadcasts"
          planName={plan.planName}
          detail={`You've used all ${monthlyLimit} broadcasts included this month.`}
        />
      ) : (
      <form action={createBroadcast} className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>New broadcast</h2>
        <p className="m-0 text-xs" style={{ color: "var(--ink-3)" }}>{quotaLeft} of {monthlyLimit} broadcasts left this month on your {plan.planName} plan.</p>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="bc-channel">Channel</label>
          <select className="field-input" id="bc-channel" name="channel">
            <option>email</option>
            <option>whatsapp</option>
            <option>push</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="bc-segment">Audience</label>
          <select className="field-input" id="bc-segment" name="segmentId">
            <option value="">All consented customers</option>
            {segments?.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="bc-subject">Subject</label>
          <input className="field-input" id="bc-subject" name="subject" placeholder="Subject" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="bc-body">Message</label>
          <textarea className="field-input" id="bc-body" name="body" placeholder="Message" rows={5} />
        </div>
        <SubmitButton className="btn-primary w-full" pendingLabel="Saving…">Save draft</SubmitButton>
      </form>
      )}

      {data?.map((item) => (
        <article className="card" key={item.id}>
          <div className="flex items-start justify-between gap-2">
            <strong style={{ color: "var(--ink)" }}>{item.subject ?? item.channel}</strong>
            <span className="badge badge-stone capitalize">{item.state}</span>
          </div>
          <p className="m-0 mt-1 text-sm" style={{ color: "var(--ink-2)" }}>{item.body}</p>
          <p className="m-0 mt-2 text-xs" style={{ color: "var(--ink-3)" }}>
            {item.scheduled_at ? `Scheduled ${new Date(item.scheduled_at).toLocaleString()}` : "Not scheduled"}
            {` · ${item.marketing_deliveries.filter((delivery) => delivery.state === "sent").length} delivered`}
          </p>
          {item.state === "draft" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={scheduleBroadcast} className="flex flex-wrap gap-2">
                <input name="id" type="hidden" value={item.id} />
                <label className="sr-only" htmlFor={`schedule-${item.id}`}>Schedule time</label>
                <input className="field-input" id={`schedule-${item.id}`} name="scheduledAt" style={{ minHeight: "2.5rem", width: "13rem" }} type="datetime-local" />
                <SubmitButton className="btn-primary" pendingLabel="Scheduling…">Schedule / send now</SubmitButton>
              </form>
              <form action={cancelBroadcast}><input name="id" type="hidden" value={item.id} /><SubmitButton className="btn-secondary" pendingLabel="Cancelling…">Cancel</SubmitButton></form>
            </div>
          ) : item.state === "scheduled" ? (
            <form action={cancelBroadcast} className="mt-3"><input name="id" type="hidden" value={item.id} /><SubmitButton className="btn-secondary" pendingLabel="Cancelling…">Cancel broadcast</SubmitButton></form>
          ) : null}
        </article>
      ))}
    </main>
  );
}
