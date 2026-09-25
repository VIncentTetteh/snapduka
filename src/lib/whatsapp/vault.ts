import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * WhatsApp secrets from Supabase Vault (migration 202609250261), cached
 * in-process.
 *
 * Why a cache: the webhook verifies a signature on every inbound message, and
 * an extra database round trip per message is latency Meta counts against its
 * retry timer. Why a *short* one: rotating a leaked app secret in Vault has to
 * take effect in minutes, not "at the next deploy".
 *
 * A failed read is cached too, for less time, so a Vault outage degrades to
 * env fallback instead of a query per request — and never throws: the caller
 * falls back to env, and with no env either, WhatsApp reports not_configured.
 */

export type WhatsAppVaultSecrets = {
  appSecret: string | null;
  accessToken: string | null;
  verifyToken: string | null;
};

export const VAULT_CACHE_TTL_MS = 5 * 60_000;
export const VAULT_FAILURE_TTL_MS = 30_000;

const row = z.object({
  app_secret: z.string().min(1).nullable(),
  access_token: z.string().min(1).nullable(),
  verify_token: z.string().min(1).nullable(),
});

let cache: { value: WhatsAppVaultSecrets | null; expiresAt: number } | null = null;
let inflight: Promise<WhatsAppVaultSecrets | null> | null = null;

async function fetchSecrets(): Promise<WhatsAppVaultSecrets | null> {
  try {
    const { data, error } = await createAdminClient().rpc("whatsapp_platform_secrets");
    if (error) {
      console.error("[whatsapp/vault] read failed; using env", { code: error.code });
      return null;
    }
    const parsed = row.safeParse(Array.isArray(data) ? data[0] : data);
    if (!parsed.success) return null;
    return {
      appSecret: parsed.data.app_secret,
      accessToken: parsed.data.access_token,
      verifyToken: parsed.data.verify_token,
    };
  } catch (error) {
    // createAdminClient throws without Supabase env (local scripts, some
    // tests). That is "no Vault", not a failure worth surfacing.
    console.error("[whatsapp/vault] unavailable; using env", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

/** Vault's WhatsApp secrets, or null when Vault could not be read. */
export async function readWhatsAppVaultSecrets(now: number = Date.now()): Promise<WhatsAppVaultSecrets | null> {
  if (cache && cache.expiresAt > now) return cache.value;
  // One read for a burst of concurrent webhook deliveries, not one each.
  inflight ??= fetchSecrets().finally(() => {
    inflight = null;
  });
  const value = await inflight;
  cache = { value, expiresAt: now + (value ? VAULT_CACHE_TTL_MS : VAULT_FAILURE_TTL_MS) };
  return value;
}

/** The last value read, without a round trip. Null before the first read or after expiry. */
export function cachedWhatsAppVaultSecrets(now: number = Date.now()): WhatsAppVaultSecrets | null {
  return cache && cache.expiresAt > now ? cache.value : null;
}

/** Tests only. */
export function resetWhatsAppVaultCache(): void {
  cache = null;
  inflight = null;
}
