import { UpgradePrompt } from "@/components/seller/upgrade-prompt";
import { resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan, planLimit } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";

import { addAutomation, addWebhook } from "./actions";
import { KeyForm } from "./key-form";

export default async function DevelopersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [{ data: keys }, { data: webhooks }, { data: rules }, plan] = await Promise.all([
    supabase.from("api_keys").select("id,name,key_prefix,scopes,last_used_at,revoked_at").eq("seller_account_id", actor.sellerAccountId),
    supabase.from("outbound_webhooks").select("id,url,event_types,active").eq("seller_account_id", actor.sellerAccountId),
    supabase.from("automation_rules").select("id,name,event_type,action,active").eq("seller_account_id", actor.sellerAccountId),
    getSellerPlan(actor.sellerAccountId),
  ]);
  const developerAccess = planLimit(plan, "apiKeys") > 0;
  const automationLimit = planLimit(plan, "automationRules");

  if (!developerAccess) {
    return (
      <main className="mx-auto grid w-full max-w-4xl gap-5 px-3 py-5 pb-16">
        <header>
          <p className="page-eyebrow m-0">Seller settings</p>
          <h1 className="page-title mt-1">Developer tools</h1>
          <p className="page-sub">Scoped API keys, signed outbound webhooks, and constrained automations.</p>
        </header>
        <UpgradePrompt feature="Developer tools" planName={plan.planName} />
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-4xl gap-5 px-3 py-5 pb-16">
      {/* A refused webhook URL — the SSRF guard doing its job — used to look
          exactly like a broken feature. */}
      {params.error ? (
        <div
          role="alert"
          className="rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-[13px] font-semibold text-danger"
        >
          {params.error}
        </div>
      ) : null}

      {params.saved ? (
        <div
          role="status"
          className="rounded-xl border border-line bg-raised px-4 py-3 text-[13px] font-semibold text-ink"
        >
          {params.saved === "webhook" ? "Webhook added." : "Automation added."}
        </div>
      ) : null}

      <header>
        <p className="page-eyebrow m-0">Seller settings</p>
        <h1 className="page-title mt-1">Developer tools</h1>
        <p className="page-sub">
          Scoped API keys, signed outbound webhooks, and constrained automations. Your {plan.planName} plan includes{" "}
          {planLimit(plan, "apiKeys")} API keys and {automationLimit} automation rules.
        </p>
      </header>

      <KeyForm />

      {keys?.map((k) => (
        <article
          className="rounded-xl px-4 py-3 text-sm"
          key={k.id}
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <span className="font-semibold" style={{ color: "var(--ink)" }}>{k.name}</span>
          <span style={{ color: "var(--ink-2)" }}> · <code>{k.key_prefix}…</code> · {k.scopes.join(", ")}</span>
        </article>
      ))}

      <form action={addWebhook} className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Outbound webhook</h2>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="webhook-url">Endpoint URL</label>
          <input className="field-input" id="webhook-url" name="url" placeholder="https://example.com/hooks/snapduka" type="url" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="webhook-secret">Signing secret</label>
          <input className="field-input" id="webhook-secret" name="secret" placeholder="Signing secret" />
        </div>
        <fieldset className="grid gap-2 rounded-xl p-3" style={{ border: "1.5px dashed var(--border)" }}>
          <legend className="field-label px-1">Events</legend>
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
            <input name="event" type="checkbox" value="order.completed" /> order.completed
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
            <input name="event" type="checkbox" value="order.created" /> order.created
          </label>
        </fieldset>
        <SubmitButton className="btn-primary w-full" pendingLabel="Adding…">Add webhook</SubmitButton>
      </form>

      {webhooks?.map((w) => (
        <article
          className="rounded-xl px-4 py-3 text-sm"
          key={w.id}
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <span style={{ color: "var(--ink)" }}>{w.url}</span>
          <span className={`ml-2 badge ${w.active ? "badge-green" : "badge-stone"}`}>
            {w.active ? "Active" : "Paused"}
          </span>
        </article>
      ))}

      <form action={addAutomation} className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Automation rule</h2>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="auto-name">Rule name</label>
          <input className="field-input" id="auto-name" name="name" placeholder="Thank fulfilled buyers" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="auto-event">Trigger event</label>
          <select className="field-input" id="auto-event" name="eventType">
            <option>order.completed</option>
            <option>order.created</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="auto-action">Action</label>
          <select className="field-input" id="auto-action" name="actionType">
            <option>notify</option>
            <option>tag_customer</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="auto-value">Notification text or customer tag</label>
          <input className="field-input" id="auto-value" name="actionValue" placeholder="Thank you / repeat-buyer" />
        </div>
        <SubmitButton className="btn-primary w-full" pendingLabel="Creating…">Create rule</SubmitButton>
      </form>

      {rules?.map((r) => (
        <article
          className="rounded-xl px-4 py-3 text-sm"
          key={r.id}
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <span className="font-semibold" style={{ color: "var(--ink)" }}>{r.name}</span>
          <span style={{ color: "var(--ink-2)" }}> · {r.event_type}</span>
        </article>
      ))}
    </main>
  );
}
