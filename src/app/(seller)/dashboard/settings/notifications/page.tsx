import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";

import { saveNotificationPreferences } from "./actions";

export default async function NotificationSettings() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Seller settings</p>
        <h1 className="page-title mt-1">Notifications</h1>
      </header>

      <form action={saveNotificationPreferences} className="card grid gap-4">
        <label className="flex items-center gap-3 text-sm font-semibold" style={{ color: "var(--ink)" }}>
          <input defaultChecked={data?.order_email ?? true} name="email" type="checkbox" />
          Order email notifications
        </label>
        <label className="flex items-center gap-3 text-sm font-semibold" style={{ color: "var(--ink)" }}>
          <input defaultChecked={data?.order_whatsapp ?? false} name="whatsapp" type="checkbox" />
          Consent-based WhatsApp
        </label>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="frequency">Digest frequency</label>
          <select
            className="field-input"
            defaultValue={data?.digest_frequency ?? "daily"}
            id="frequency"
            name="frequency"
          >
            <option value="instant">Instant</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="off">Off</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="cap">Marketing messages per 30 days</label>
          <input
            className="field-input"
            defaultValue={data?.marketing_frequency_cap ?? 4}
            id="cap"
            max="31"
            min="0"
            name="cap"
            type="number"
          />
        </div>
        <SubmitButton className="btn-primary w-full" pendingLabel="Saving…">Save preferences</SubmitButton>
      </form>
    </main>
  );
}
