import type { CountryCode } from "@/lib/countries/types";

/**
 * Client-safe field validators shared by buyer/seller forms.
 * Server actions keep their own zod schemas — these exist so users get
 * immediate, specific feedback before a request is made.
 */

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateEmail(value: string): string | null {
  if (!value.trim()) return "Enter your email address.";
  if (!EMAIL_PATTERN.test(value.trim())) return "Enter a valid email address.";
  return null;
}

export function validateName(value: string, label = "your name"): string | null {
  if (value.trim().length < 2) return `Enter ${label} (at least 2 characters).`;
  return null;
}

const PHONE_RULES: Record<CountryCode, { pattern: RegExp; example: string }> = {
  GH: { pattern: /^(\+233|0)\d{9}$/, example: "024 123 4567" },
  NG: { pattern: /^(\+234|0)\d{10}$/, example: "0801 234 5678" },
  CI: { pattern: /^(\+225)?\d{10}$/, example: "07 08 09 10 11" },
};

export function validatePhone(value: string, country: CountryCode): string | null {
  const digits = value.replace(/[\s-]/g, "");
  if (!digits) return "Enter your phone number.";
  const rule = PHONE_RULES[country];
  if (!rule.pattern.test(digits)) {
    return `Enter a valid phone number, e.g. ${rule.example}.`;
  }
  return null;
}

export function validateRequired(value: string, message: string): string | null {
  return value.trim() ? null : message;
}

/** Positive amount in major units ("240", "240.50"); XOF uses whole units. */
export function validateAmount(value: string, currency: string): string | null {
  if (!value.trim()) return "Enter an amount.";
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Enter an amount greater than zero.";
  if (currency === "XOF" && !Number.isInteger(parsed)) {
    return "XOF amounts are whole numbers.";
  }
  return null;
}

/** Non-negative integer (stock quantities, minor-unit prices). */
export function validateWholeNumber(value: string, label = "value"): string | null {
  if (!value.trim()) return `Enter a ${label}.`;
  if (!/^\d+$/.test(value.trim())) return `The ${label} must be a whole number.`;
  return null;
}
