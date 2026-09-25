// Single source for web + mobile (the web copy in src/lib/countries was removed).
export type CountryCode = "GH" | "NG" | "CI";

export type CurrencyCode = "GHS" | "NGN" | "XOF";

export type CallingCode = "+233" | "+234" | "+225";

export type AddressField = "line1" | "area" | "city" | "region";

export interface CountryConfig {
  readonly code: CountryCode;
  readonly currency: CurrencyCode;
  readonly callingCode: CallingCode;
  readonly addressFields: readonly AddressField[];
}
