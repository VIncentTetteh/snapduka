"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { getSellerPlan, withinPlanLimit } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";

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
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "campaigns.manage")) return;
  const channel = String(formData.get("channel"));
  const body = String(formData.get("body")).trim();
  const segmentId = String(formData.get("segmentId") ?? "");
  if (!["email", "whatsapp", "push"].includes(channel) || !body) return;
  const supabase = await createClient();
  if (segmentId) {
    const { data: segment } = await supabase
      .from("customer_segments")
      .select("id")
      .eq("id", segmentId)
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle();
    if (!segment) return;
  }
  const [plan, used] = await Promise.all([
    getSellerPlan(actor.sellerAccountId),
    monthlyBroadcastUsage(supabase, actor.sellerAccountId),
  ]);
  if (!withinPlanLimit(plan, "broadcastsPerMonth", used)) return;
  await supabase.from("marketing_broadcasts").insert({
    body,
    channel,
    segment_id: segmentId || null,
    seller_account_id: actor.sellerAccountId,
    state: "draft",
    subject: String(formData.get("subject")).trim() || null,
  });
  revalidatePath("/dashboard/growth/broadcasts");
}

export async function scheduleBroadcast(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "campaigns.manage")) return;
  const id = String(formData.get("id") ?? "");
  const scheduledInput = String(formData.get("scheduledAt") ?? "");
  const scheduledAt = scheduledInput ? new Date(scheduledInput) : new Date();
  if (!id || Number.isNaN(scheduledAt.valueOf())) return;
  const supabase = await createClient();
  await supabase
    .from("marketing_broadcasts")
    .update({ scheduled_at: scheduledAt.toISOString(), state: "scheduled" })
    .eq("id", id)
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("state", "draft");
  revalidatePath("/dashboard/growth/broadcasts");
}

export async function cancelBroadcast(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "campaigns.manage")) return;
  const supabase = await createClient();
  await supabase
    .from("marketing_broadcasts")
    .update({ state: "cancelled" })
    .eq("id", String(formData.get("id") ?? ""))
    .eq("seller_account_id", actor.sellerAccountId)
    .in("state", ["draft", "scheduled"]);
  revalidatePath("/dashboard/growth/broadcasts");
}
