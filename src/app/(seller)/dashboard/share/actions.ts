"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

export async function disconnectSocialAccountAction(formData: FormData): Promise<void> {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return;
  const provider = String(formData.get("provider") ?? "");
  if (!provider) return;
  const supabase = await createClient();
  await supabase
    .from("social_accounts")
    .delete()
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("provider", provider);
  revalidatePath("/dashboard/share");
}

const CHANNELS = ["tiktok", "instagram", "snapchat", "whatsapp"] as const;
const CHANNEL_SUFFIX: Record<(typeof CHANNELS)[number], string> = {
  tiktok: "t",
  instagram: "i",
  snapchat: "s",
  whatsapp: "w",
};

function shortCode(): string {
  return Math.random().toString(36).slice(2, 6);
}

/** Creates the per-channel tracked short links for a destination if missing. */
export async function generateShareLinksAction(formData: FormData): Promise<void> {
  const destinationPath = String(formData.get("destinationPath") ?? "/");
  const label = String(formData.get("label") ?? "Storefront").slice(0, 80);
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return;

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();
  if (!shop) return;

  const { data: existing } = await supabase
    .from("campaign_links")
    .select("channel")
    .eq("seller_account_id", actor.sellerAccountId)
    .eq("destination_path", destinationPath)
    .eq("active", true);

  const existingChannels = new Set((existing ?? []).map((link) => link.channel));
  const base = shortCode();
  const rows = CHANNELS.filter((channel) => !existingChannels.has(channel)).map((channel) => ({
    seller_account_id: actor.sellerAccountId,
    shop_id: shop.id,
    name: `${label} · ${channel}`,
    token: `${base}-${CHANNEL_SUFFIX[channel]}`,
    channel,
    destination_path: destinationPath,
    active: true,
  }));

  if (rows.length > 0) {
    await supabase.from("campaign_links").insert(rows);
  }

  revalidatePath("/dashboard/share");
}
