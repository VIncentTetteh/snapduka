export type CountryCode = "GH" | "NG";

export type CurrencyCode = "GHS" | "NGN";

export type CallingCode = "+233" | "+234";

export type AddressField = "line1" | "area" | "city" | "region";

export interface CountryConfig {
  readonly code: CountryCode;
  readonly currency: CurrencyCode;
  readonly callingCode: CallingCode;
  readonly addressFields: readonly AddressField[];
}
