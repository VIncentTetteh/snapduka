"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export async function saveNotificationPreferences(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "settings.manage")) {
    return;
  }

  const cap = Number(formData.get("cap") ?? 4);
  // The column is `check (marketing_frequency_cap between 0 and 31)`; a value
  // outside it would abort the whole upsert, losing the other preferences too.
  if (!Number.isFinite(cap) || cap < 0 || cap > 31) return;

  const supabase = await createClient();

  // digest_frequency is deliberately NOT written. Its selector was removed
  // because nothing reads the column — notifications are always sent per event,
  // so the control silently did nothing. This used to read it from the form and
  // `return` early when it failed the whitelist; once the field was gone that
  // check rejected every submission, silently discarding the preferences the
  // seller had actually changed. Omitting it from the upsert keeps whatever is
  // stored (or the column default on first insert).
  await supabase.from("notification_preferences").upsert({
    seller_account_id: actor.sellerAccountId,
    order_email: formData.get("email") === "on",
    order_whatsapp: formData.get("whatsapp") === "on",
    order_sms: formData.get("sms") === "on",
    marketing_frequency_cap: cap,
  });

  revalidatePath("/dashboard/settings/notifications");
}
