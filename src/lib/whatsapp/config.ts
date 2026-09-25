import { cachedWhatsAppVaultSecrets, readWhatsAppVaultSecrets, type WhatsAppVaultSecrets } from "./vault";

/**
 * WhatsApp Cloud API configuration. Every consumer treats a missing value as
 * "not configured" rather than an error, so the platform runs normally before
 * Meta credentials exist.
 *
 * The secrets (app secret, access token, verify token) come from Supabase Vault
 * first and the environment second (see ./vault.ts and migration
 * 202609250261): Vault is where production keeps them, env is how local
 * development runs without seeding Vault. Each is resolved independently, so a
 * partially seeded Vault still works. The phone number id is not a secret and
 * stays in env.
 *
 * Use the async `load*` functions on any path that authenticates or sends:
 * they read Vault (cached for minutes). The sync functions only see what an
 * earlier load already cached, falling back to env — kept for callers that
 * cannot await, which therefore see Vault-only credentials only once warm.
 */

/** Graph API version. Pinned: Meta changes payload shapes between versions. */
export const GRAPH_API_VERSION = "v23.0";
export const GRAPH_API_BASE = "https://graph.facebook.com";

export type WhatsAppCloudConfig = {
  phoneNumberId: string;
  accessToken: string;
};

function cloudConfig(vault: WhatsAppVaultSecrets | null): WhatsAppCloudConfig | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = vault?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken };
}

/** Credentials for sending. Null until both are set. Sync: see the module note. */
export function whatsAppCloudConfig(): WhatsAppCloudConfig | null {
  return cloudConfig(cachedWhatsAppVaultSecrets());
}

/** Secret for X-Hub-Signature-256 on inbound webhooks. Sync: see the module note. */
export function whatsAppAppSecret(): string | null {
  return cachedWhatsAppVaultSecrets()?.appSecret || process.env.WHATSAPP_APP_SECRET || null;
}

/** Token Meta echoes on the GET verification handshake. Sync: see the module note. */
export function whatsAppVerifyToken(): string | null {
  return cachedWhatsAppVaultSecrets()?.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || null;
}

/** Credentials for sending, Vault first. */
export async function loadWhatsAppCloudConfig(): Promise<WhatsAppCloudConfig | null> {
  return cloudConfig(await readWhatsAppVaultSecrets());
}

/** Webhook signing secret, Vault first. */
export async function loadWhatsAppAppSecret(): Promise<string | null> {
  return (await readWhatsAppVaultSecrets())?.appSecret || process.env.WHATSAPP_APP_SECRET || null;
}

/** Webhook verify token, Vault first. */
export async function loadWhatsAppVerifyToken(): Promise<string | null> {
  return (await readWhatsAppVaultSecrets())?.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || null;
}

// Re-exported so existing imports keep working; it lives in ./phone because
// this module now reads Vault (server-only) and the webhook parser does not.
export { toE164 } from "./phone";
