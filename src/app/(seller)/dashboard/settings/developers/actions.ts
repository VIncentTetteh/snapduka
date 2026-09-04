"use server";

import { revalidatePath } from "next/cache";

import { issueApiKey } from "@/lib/api-keys/issue";
import { resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan, planLimit, withinPlanLimit } from "@/lib/billing/resolve";
import { isSafeWebhookUrl } from "@/lib/security/url";
import { createClient } from "@/lib/supabase/server";

export type KeyState = { token?: string; error?: string };

export async function generateKey(_: KeyState, formData: FormData): Promise<KeyState> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role) return { error: "API key generation is not configured." };

  // The issuing itself lives in @/lib/api-keys/issue so the mobile route runs
  // the same scope allow-list and plan limit.
  const result = await issueApiKey(actor, {
    name: String(formData.get("name") ?? ""),
    scopes: formData.getAll("scope").map(String),
  });

  revalidatePath("/dashboard/settings/developers");
  return result.ok ? { token: result.token } : { error: result.message };
}

export async function addWebhook(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role) return;
  const webhookPlan = await getSellerPlan(actor.sellerAccountId);
  if (planLimit(webhookPlan, "apiKeys") === 0) return;
  const url = String(formData.get("url")).trim();
  if (!(await isSafeWebhookUrl(url))) return;
  const supabase = await createClient();
  await supabase.from("outbound_webhooks").insert({ seller_account_id: actor.sellerAccountId, url, secret_encrypted: String(formData.get("secret")), event_types: formData.getAll("event").map(String) });
  revalidatePath("/dashboard/settings/developers");
}

export async function addAutomation(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role) return;
  const supabase = await createClient();
  const [plan, { count: ruleCount }] = await Promise.all([
    getSellerPlan(actor.sellerAccountId),
    supabase.from("automation_rules").select("id", { count: "exact", head: true }).eq("seller_account_id", actor.sellerAccountId).eq("active", true),
  ]);
  if (!withinPlanLimit(plan, "automationRules", ruleCount ?? 0)) return;
  const eventType = String(formData.get("eventType"));
  const actionType = String(formData.get("actionType"));
  if (!["order.created", "order.completed"].includes(eventType) || !["notify", "tag_customer"].includes(actionType)) return;
  await supabase.from("automation_rules").insert({ seller_account_id: actor.sellerAccountId, name: String(formData.get("name")).trim() || "Automation", event_type: eventType, conditions: {}, action: { type: actionType, value: String(formData.get("actionValue") ?? "").trim() } });
  revalidatePath("/dashboard/settings/developers");
}
