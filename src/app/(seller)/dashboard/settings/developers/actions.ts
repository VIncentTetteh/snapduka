"use server";

import { revalidatePath } from "next/cache";

import { createApiKey } from "@/lib/api-keys/keys";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

export type KeyState = { token?: string; error?: string };

export async function generateKey(_: KeyState, formData: FormData): Promise<KeyState> {
  const actor = await resolveServerActor();
  const pepper = process.env.API_KEY_PEPPER;
  if (actor.kind !== "seller" || actor.role || !pepper) return { error: "API key generation is not configured." };
  const scopes = formData.getAll("scope").map(String).filter((scope) => ["products:read","orders:read","customers:read","fulfillment:write"].includes(scope));
  if (!scopes.length) return { error: "Select at least one scope." };
  const key = createApiKey(pepper);
  const supabase = await createClient();
  const { error } = await supabase.from("api_keys").insert({ id: key.id, seller_account_id: actor.sellerAccountId, name: String(formData.get("name")).trim() || "API key", key_prefix: key.prefix, key_hash: key.hash, scopes });
  revalidatePath("/dashboard/settings/developers");
  return error ? { error: "Could not create key." } : { token: key.token };
}

export async function addWebhook(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role) return;
  const url = String(formData.get("url"));
  try { new URL(url); } catch { return; }
  const supabase = await createClient();
  await supabase.from("outbound_webhooks").insert({ seller_account_id: actor.sellerAccountId, url, secret_encrypted: String(formData.get("secret")), event_types: formData.getAll("event").map(String) });
  revalidatePath("/dashboard/settings/developers");
}

export async function addAutomation(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role) return;
  const supabase = await createClient();
  const eventType = String(formData.get("eventType"));
  const actionType = String(formData.get("actionType"));
  if (!["order.created", "order.completed"].includes(eventType) || !["notify", "tag_customer"].includes(actionType)) return;
  await supabase.from("automation_rules").insert({ seller_account_id: actor.sellerAccountId, name: String(formData.get("name")).trim() || "Automation", event_type: eventType, conditions: {}, action: { type: actionType, value: String(formData.get("actionValue") ?? "").trim() } });
  revalidatePath("/dashboard/settings/developers");
}
