import type { CountryCode } from "./types";

/**
 * Exact local-digit counts for each country's mobile numbers, applied to
 * the already-normalized "+<callingCode><digits>" shape produced by
 * normalizePhone().
 */
const PHONE_RULES: Record<CountryCode, { callingCode: string; localDigits: number; example: string }> = {
  GH: { callingCode: "233", localDigits: 9, example: "+233241234567" },
  NG: { callingCode: "234", localDigits: 10, example: "+2348012345678" },
  CI: { callingCode: "225", localDigits: 10, example: "+2250708091011" },
};

function phonePatternFor(country: CountryCode): RegExp {
  const { callingCode, localDigits } = PHONE_RULES[country];
  return new RegExp(`^\\+${callingCode}\\d{${localDigits}}$`);
}

/** Validates an already-normalized phone number against the exact digit
 * count for the given country — not a shared cross-country length range. */
export function isValidPhoneForCountry(normalizedPhone: string, country: CountryCode): boolean {
  return phonePatternFor(country).test(normalizedPhone);
}

export function phoneExampleFor(country: CountryCode): string {
  return PHONE_RULES[country].example;
}
