import type { CountryCode, CountryConfig } from "./types";

const COUNTRY_CONFIGS = Object.freeze({
  GH: Object.freeze({
    code: "GH",
    currency: "GHS",
    callingCode: "+233",
    addressFields: Object.freeze(["line1", "area", "city", "region"] as const),
  }),
  NG: Object.freeze({
    code: "NG",
    currency: "NGN",
    callingCode: "+234",
    addressFields: Object.freeze(["line1", "area", "city", "region"] as const),
  }),
  CI: Object.freeze({
    code: "CI",
    currency: "XOF",
    callingCode: "+225",
    addressFields: Object.freeze(["line1", "area", "city", "region"] as const),
  }),
} satisfies Readonly<Record<CountryCode, CountryConfig>>);

export function getCountryConfig(countryCode: string): CountryConfig {
  if (!Object.hasOwn(COUNTRY_CONFIGS, countryCode)) {
    throw new Error(`Unsupported country code: ${countryCode}`);
  }

  return COUNTRY_CONFIGS[countryCode as CountryCode];
}
