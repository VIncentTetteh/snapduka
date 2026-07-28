import { z } from "zod";

import { getCountryConfig } from "@/lib/countries/config";
import { isValidPhoneForCountry, phoneExampleFor, phoneLocalDigitsFor } from "@/lib/countries/phone";
import type { CountryCode } from "@/lib/countries/types";

export type ClassifiedIdentifier =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string }
  | { kind: "invalid" };

/** Matches the E.164 shape already enforced on seller_accounts.contact_phone
 * (supabase/migrations/202606120001_core.sql). */
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;

/**
 * Classifies an already-normalized login identifier as an email or an E.164
 * phone number. The login form now submits a normalized value plus an
 * explicit mode, so this is used for the round trip through the code step,
 * where the identifier travels in the URL and comes back as freeform text.
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

// ---------------------------------------------------------------------------
// Tab-aware validation
//
// The same functions run in the browser for instant feedback and again in the
// server action, which stays authoritative — a tampered or JS-disabled
// submission gets the identical verdict.
// ---------------------------------------------------------------------------

export type IdentifierMode = "email" | "phone";

/** A supported country, or "OTHER" for any country we have no digit rule for. */
export type PhoneRegion = CountryCode | "OTHER";

export type PhoneRegionOption = {
  value: PhoneRegion;
  label: string;
  /** null for "OTHER", where the caller types the full international number. */
  callingCode: string | null;
};

export const PHONE_REGIONS: readonly PhoneRegionOption[] = [
  { value: "GH", label: "Ghana", callingCode: "+233" },
  { value: "NG", label: "Nigeria", callingCode: "+234" },
  { value: "CI", label: "Côte d’Ivoire", callingCode: "+225" },
  { value: "OTHER", label: "Other", callingCode: null },
];

export const DEFAULT_PHONE_REGION: PhoneRegion = "GH";

export type IdentifierResult =
  | { ok: true; kind: IdentifierMode; value: string }
  | { ok: false; message: string };

export function isPhoneRegion(value: string): value is PhoneRegion {
  return PHONE_REGIONS.some((region) => region.value === value);
}

export function isIdentifierMode(value: string): value is IdentifierMode {
  return value === "email" || value === "phone";
}

function regionLabel(region: CountryCode): string {
  return PHONE_REGIONS.find((option) => option.value === region)?.label ?? region;
}

export function validateEmailIdentifier(raw: string): IdentifierResult {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return { ok: false, message: "Enter your email address." };

  const parsed = z.email().safeParse(trimmed);
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid email address, like you@example.com." };
  }
  return { ok: true, kind: "email", value: parsed.data };
}

/**
 * Folds the ways people actually write a phone number into E.164.
 *
 * For a known region that means local ("24 123 4567"), national with a trunk
 * zero ("0241234567") and full international ("+233241234567") all land on the
 * same value. Typing an explicit "+" always wins, so someone who selects Ghana
 * but pastes a Nigerian number still gets validated as what they pasted.
 */
export function normalizePhoneInput(raw: string, region: PhoneRegion): string {
  const compact = raw.replace(/[\s()\-.]/g, "");
  if (compact.startsWith("+")) return compact;
  if (region === "OTHER") return compact;

  const { callingCode } = getCountryConfig(region);
  const local = compact.replace(/^0+/, "");
  return `${callingCode}${local}`;
}

export function validatePhoneIdentifier(raw: string, region: PhoneRegion): IdentifierResult {
  if (raw.trim().length === 0) return { ok: false, message: "Enter your phone number." };

  const normalized = normalizePhoneInput(raw, region);

  if (region === "OTHER") {
    return PHONE_PATTERN.test(normalized)
      ? { ok: true, kind: "phone", value: normalized }
      : {
          ok: false,
          message: "Enter your number in international format, starting with + and your country code.",
        };
  }

  if (!isValidPhoneForCountry(normalized, region)) {
    const { callingCode } = getCountryConfig(region);
    return {
      ok: false,
      message: `${regionLabel(region)} numbers have ${phoneLocalDigitsFor(region)} digits after ${callingCode}. Example: ${phoneExampleFor(region)}`,
    };
  }

  return { ok: true, kind: "phone", value: normalized };
}

export function validateIdentifier(
  mode: IdentifierMode,
  raw: string,
  region: PhoneRegion = DEFAULT_PHONE_REGION,
): IdentifierResult {
  return mode === "email" ? validateEmailIdentifier(raw) : validatePhoneIdentifier(raw, region);
}
