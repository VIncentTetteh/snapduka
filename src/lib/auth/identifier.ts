import { z } from "zod";

export type ClassifiedIdentifier =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string }
  | { kind: "invalid" };

/** Matches the E.164 shape already enforced on seller_accounts.contact_phone
 * (supabase/migrations/202606120001_core.sql). */
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;

/**
 * Classifies a single freeform login identifier as an email or an E.164
 * phone number. Used by the login flow so one input field can accept
 * either — there is no separate email/phone toggle in the UI.
 */
export function classifyIdentifier(raw: string): ClassifiedIdentifier {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "invalid" };

  if (trimmed.includes("@")) {
    const parsed = z.email().safeParse(trimmed.toLowerCase());
    return parsed.success ? { kind: "email", value: parsed.data } : { kind: "invalid" };
  }

  const normalized = trimmed.replace(/[\s()-]/g, "");
  return PHONE_PATTERN.test(normalized) ? { kind: "phone", value: normalized } : { kind: "invalid" };
}
