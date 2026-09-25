/**
 * E.164 with a leading +, as stored in `wa_conversations`, from whatever a
 * caller holds ("+233 20 123 4567", "233201234567"). Null when it cannot be one.
 *
 * Kept free of imports: the webhook parser uses it, and must stay importable
 * without the server-only Vault reader that ./config pulls in.
 */
export function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const e164 = `+${digits}`;
  return /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164 : null;
}
