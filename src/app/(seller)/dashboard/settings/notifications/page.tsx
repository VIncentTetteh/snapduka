import { ActionBanner } from "@/components/ui/action-banner";
import { resolveServerActor } from "@/lib/auth/actor";
import { isSmsConfigured } from "@/lib/notifications/sms";
import { isWhatsAppConfigured } from "@/lib/notifications/whatsapp";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";

import { saveNotificationPreferences } from "./actions";

export default async function NotificationSettings({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const banner = await searchParams;
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();

  // Never offer a channel the platform cannot deliver on. Ticking WhatsApp
  // while WHATSAPP_WEBHOOK_URL is unset enqueued a buyer notification for every
  // order that could only ever dead-letter — the seller believed they had
  // enabled it and nobody was told otherwise. Buyers still get the order email
  // either way; the broken promise was to the seller.
  const whatsappReady = isWhatsAppConfigured();
  const smsReady = isSmsConfigured();

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-5 px-3 py-5 pb-16">
      <ActionBanner error={banner.error} saved={banner.saved ? "Saved." : undefined} />

      <header>
        <p className="page-eyebrow m-0">Seller settings</p>
        <h1 className="page-title mt-1">Notifications</h1>
      </header>

      <form action={saveNotificationPreferences} className="card grid gap-4">
        <label className="flex items-center gap-3 text-sm font-semibold" style={{ color: "var(--ink)" }}>
          <input defaultChecked={data?.order_email ?? true} name="email" type="checkbox" />
          Order email notifications
        </label>
        <div className="grid gap-1">
          <label
            className="flex items-center gap-3 text-sm font-semibold"
            style={{ color: whatsappReady ? "var(--ink)" : "var(--ink-muted)" }}
          >
            <input
              defaultChecked={data?.order_whatsapp ?? false}
              disabled={!whatsappReady}
              name="whatsapp"
              type="checkbox"
            />
            Consent-based WhatsApp
          </label>
          {whatsappReady ? null : (
            <p className="text-[12px] leading-[1.5]" style={{ color: "var(--ink-muted)" }}>
              Not available yet — SnapDuka has no WhatsApp provider connected, so these
              messages could not be delivered. Buyers still get order updates by email.
            </p>
          )}
        </div>
        <div className="grid gap-1">
          <label
            className="flex items-center gap-3 text-sm font-semibold"
            style={{ color: smsReady ? "var(--ink)" : "var(--ink-muted)" }}
          >
            <input
              defaultChecked={data?.order_sms ?? false}
              disabled={!smsReady}
              name="sms"
              type="checkbox"
            />
            Consent-based SMS
          </label>
          {smsReady ? null : (
            <p className="text-[12px] leading-[1.5]" style={{ color: "var(--ink-muted)" }}>
              Not available yet — no SMS provider is connected. Buyers still get order
              updates by email.
            </p>
          )}
        </div>
        {/* The digest frequency selector was removed here. It wrote
            notification_preferences.digest_frequency, which has no reader
            anywhere — notifications are always sent per event, so choosing
            "Weekly" or "Off" changed nothing at all. The column is kept so a
            real digest job can use it later; offering the control before that
            exists only misleads. */}
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
