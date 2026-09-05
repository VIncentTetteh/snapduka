"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { issueApiKey } from "@/lib/api-keys/issue";
import { resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan, planLimit, withinPlanLimit } from "@/lib/billing/resolve";
import { isSafeWebhookUrl } from "@/lib/security/url";
import { createClient } from "@/lib/supabase/server";

export type KeyState = { token?: string; error?: string };

const PATH = "/dashboard/settings/developers";

/**
 * Webhooks and automations refused in silence.
 *
 * The URL check is the one that matters most: isSafeWebhookUrl rejects private
 * and link-local addresses, so a seller who pastes an internal hostname gets no
 * webhook and no explanation — and the natural conclusion is that webhooks are
 * broken, not that the address was refused on purpose. A rejected SSRF attempt
 * and a typo look identical to the person typing.
 */
function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

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
  if (actor.kind !== "seller") fail("Sign in as a seller to add a webhook.");
  if (actor.role) fail("Only the account owner can manage webhooks.");

  const webhookPlan = await getSellerPlan(actor.sellerAccountId);
  if (planLimit(webhookPlan, "apiKeys") === 0) {
    fail("Webhooks are not included in your plan.");
  }

  const url = String(formData.get("url") ?? "").trim();
  if (!url) fail("Enter the URL SnapDuka should send events to.");
  if (!(await isSafeWebhookUrl(url))) {
    fail("That URL cannot be used. It must be a public https address, not a private or internal one.");
  }

  const secret = String(formData.get("secret") ?? "").trim();
  if (!secret) fail("Enter a signing secret so you can verify the events you receive.");

  const eventTypes = formData.getAll("event").map(String).filter(Boolean);
  if (eventTypes.length === 0) fail("Choose at least one event to send.");

  // Through create_outbound_webhook rather than a direct insert: the secret
  // goes into Vault and never touches a column. Direct INSERT is revoked, so a
  // webhook cannot be created without a secret and end up unsignable.
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_outbound_webhook", {
    p_url: url,
    p_event_types: eventTypes,
    p_secret: secret,
  });
  if (error) fail("That webhook could not be saved.");

  revalidatePath(PATH);
  redirect(`${PATH}?saved=webhook`);
}

export async function addAutomation(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") fail("Sign in as a seller to add an automation.");
  if (actor.role) fail("Only the account owner can manage automations.");

  const supabase = await createClient();
  const [plan, { count: ruleCount }] = await Promise.all([
    getSellerPlan(actor.sellerAccountId),
    supabase
      .from("automation_rules")
      .select("id", { count: "exact", head: true })
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("active", true),
  ]);
  if (!withinPlanLimit(plan, "automationRules", ruleCount ?? 0)) {
    fail("You have used every automation your plan includes.");
  }

  const eventType = String(formData.get("eventType") ?? "");
  const actionType = String(formData.get("actionType") ?? "");
  if (!["order.created", "order.completed"].includes(eventType)) {
    fail("Choose an event for this automation.");
  }
  if (!["notify", "tag_customer"].includes(actionType)) {
    fail("Choose what this automation should do.");
  }

  const { error } = await supabase.from("automation_rules").insert({
    seller_account_id: actor.sellerAccountId,
    name: String(formData.get("name") ?? "").trim() || "Automation",
    event_type: eventType,
    conditions: {},
    action: { type: actionType, value: String(formData.get("actionValue") ?? "").trim() },
  });
  if (error) fail("That automation could not be saved.");

  revalidatePath(PATH);
  redirect(`${PATH}?saved=automation`);
}
