"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { getSellerPlan, withinPlanLimit } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";

const PATH = "/dashboard/growth/broadcasts";

/**
 * Broadcasts, where the monthly plan limit is the refusal a seller actually
 * meets: they write a message, press send, and the page comes back with the
 * message gone and no mention of a limit or an upgrade. Every branch here was
 * silent, including that one.
 */
function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

const NOT_ALLOWED = "Your role does not allow sending broadcasts.";

/** Broadcasts created since the start of the current calendar month. */
async function monthlyBroadcastUsage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sellerAccountId: string,
): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("marketing_broadcasts")
    .select("id", { count: "exact", head: true })
    .eq("seller_account_id", sellerAccountId)
    .gte("created_at", monthStart.toISOString());
  return count ?? 0;
}

export async function createBroadcast(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to send a broadcast.");
  if (!hasPermission(actor.role ?? "owner", "campaigns.manage")) fail(NOT_ALLOWED);

  const channel = String(formData.get("channel"));
  const body = String(formData.get("body") ?? "").trim();
  const segmentId = String(formData.get("segmentId") ?? "");
  if (!["email", "whatsapp", "push"].includes(channel)) {
    fail("Choose whether to send by email, WhatsApp or push.");
  }
  if (!body) fail("Write the message before saving it.");

  const supabase = await createClient();
  if (segmentId) {
    const { data: segment } = await supabase
      .from("customer_segments")
      .select("id")
      .eq("id", segmentId)
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle();
    if (!segment) fail("That customer group could not be found.");
  }

  const [plan, used] = await Promise.all([
    getSellerPlan(actor.sellerAccountId),
    monthlyBroadcastUsage(supabase, actor.sellerAccountId),
  ]);
  if (!withinPlanLimit(plan, "broadcastsPerMonth", used)) {
    fail(`You have used all ${used} broadcasts your plan includes this month.`);
  }

  const { error } = await supabase.from("marketing_broadcasts").insert({
    body,
    channel,
    segment_id: segmentId || null,
    seller_account_id: actor.sellerAccountId,
    state: "draft",
    subject: String(formData.get("subject") ?? "").trim() || null,
  });
  if (error) fail("That broadcast could not be saved.");

  revalidatePath(PATH);
  redirect(`${PATH}?saved=created`);
}

export async function scheduleBroadcast(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to schedule a broadcast.");
  if (!hasPermission(actor.role ?? "owner", "campaigns.manage")) fail(NOT_ALLOWED);

  const id = String(formData.get("id") ?? "");
  const scheduledInput = String(formData.get("scheduledAt") ?? "");
  const scheduledAt = scheduledInput ? new Date(scheduledInput) : new Date();
  if (!id) fail("That broadcast could not be identified.");
  if (Number.isNaN(scheduledAt.valueOf())) fail("Enter a valid date and time to send.");

  // `.eq("state", "draft")` means an already-scheduled broadcast matches
  // nothing, which used to be indistinguishable from success.
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("marketing_broadcasts")
    .update({ scheduled_at: scheduledAt.toISOString(), state: "scheduled" })
    .eq("id", id)
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("state", "draft")
    .select("id");
  if (error) fail("That broadcast could not be scheduled.");
  if (!updated?.length) fail("That broadcast is no longer a draft, so it cannot be scheduled.");

  revalidatePath(PATH);
  redirect(`${PATH}?saved=scheduled`);
}

export async function cancelBroadcast(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to cancel a broadcast.");
  if (!hasPermission(actor.role ?? "owner", "campaigns.manage")) fail(NOT_ALLOWED);

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("marketing_broadcasts")
    .update({ state: "cancelled" })
    .eq("id", String(formData.get("id") ?? ""))
    .eq("seller_account_id", actor.sellerAccountId)
    .in("state", ["draft", "scheduled"])
    .select("id");
  if (error) fail("That broadcast could not be cancelled.");
  // A broadcast already sending or sent cannot be pulled back, and a seller
  // trying to stop one needs to know that immediately.
  if (!updated?.length) {
    fail("That broadcast has already started sending, so it cannot be cancelled.");
  }

  revalidatePath(PATH);
  redirect(`${PATH}?saved=cancelled`);
}
