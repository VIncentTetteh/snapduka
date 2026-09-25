import { describe, expect, it, test } from "vitest";

import type { CountryCode, CurrencyCode } from "../countries/types";

import {
  COUNTRY_DEFAULT_LOCALE,
  LOCALES,
  MESSAGE_CATALOGS,
  checkCatalogs,
  dictionary,
  formatMoney,
  interpolate,
  isDraft,
  matchLocale,
  normalizePhone,
  parseAcceptLanguage,
  placeholdersOf,
  resolveLocale,
  resolveRequestLocale,
  translate,
} from "./index";
import { en } from "./messages/en";
import { fr } from "./messages/fr";
import { pcm } from "./messages/pcm";
import { tw } from "./messages/tw";

// Ported from the deleted web copy (src/lib/i18n/index.test.ts); these must
// keep passing unchanged.
describe("localization (legacy web tests)", () => {
  test("keeps dictionary parity and falls back to English", () => {
    expect(Object.keys(fr)).toEqual(Object.keys(en));
    expect(dictionary("de")).toBe(en);
  });
  test("formats zero-decimal XOF", () => {
    // U+202F narrow no-break space, as ICU emits for fr-CI grouping.
    expect(formatMoney(12500, "XOF", "fr-CI")).toContain("12\u202f500");
  });
  test("normalizes Côte d'Ivoire phones", () => {
    expect(normalizePhone("07 08 09 10 11", "CI")).toBe("+2250708091011");
  });
});

// Verbatim copies of the implementations before consolidation. The shared
// versions must produce byte-identical output for every input below.
function legacyFormatMoney(minor: number, currency: CurrencyCode, locale = "en-GH") {
  const digits = currency === "XOF" ? 0 : 2;
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(currency === "XOF" ? minor : minor / 100);
}
function legacyNormalizePhone(value: string, country: CountryCode) {
  const config = { GH: "+233", NG: "+234", CI: "+225" }[country];
  const national = value.replace(/\D/g, "");
  const digits = country === "CI" ? national : national.replace(/^0/, "");
  return value.trim().startsWith("+") ? `+${value.replace(/\D/g, "")}` : `${config}${digits}`;
}

describe("formatMoney / normalizePhone are byte-identical to the legacy copies", () => {
  const amounts = [0, 1, 99, 100, 12500, 123456789, -2500];
  const currencies: CurrencyCode[] = ["GHS", "NGN", "XOF"];
  const locales = [undefined, "en-GH", "en-NG", "fr-CI", "en"];
  it("formatMoney", () => {
    for (const amount of amounts)
      for (const currency of currencies)
        for (const locale of locales)
          expect(formatMoney(amount, currency, locale)).toBe(legacyFormatMoney(amount, currency, locale));
  });

  it("normalizePhone", () => {
    const inputs = ["0241234567", "024 123 4567", "+233 24 123 4567", "08031234567", "07 08 09 10 11", " +2250708091011 ", "241234567", ""];
    const countries: CountryCode[] = ["GH", "NG", "CI"];
    for (const input of inputs)
      for (const country of countries) expect(normalizePhone(input, country)).toBe(legacyNormalizePhone(input, country));
  });
});

describe("catalogues", () => {
  it("pass the shared checker (key parity, placeholder parity, well-formed)", () => {
    const { en: reference, ...others } = MESSAGE_CATALOGS;
    const result = checkCatalogs(reference, others);
    expect(result.errors).toEqual([]);
  });

  it("keep English and French fully reviewed", () => {
    expect(Object.values(en).every((value) => typeof value === "string")).toBe(true);
    expect(Object.values(fr).every((value) => typeof value === "string")).toBe(true);
  });

  it("mark every Pidgin and Twi string as a machine draft", () => {
    expect(Object.values(pcm).every(isDraft)).toBe(true);
    expect(Object.values(tw).every(isDraft)).toBe(true);
  });

  it("covers every declared locale", () => {
    expect(Object.keys(MESSAGE_CATALOGS).sort()).toEqual([...LOCALES].sort());
  });
});

describe("checkCatalogs", () => {
  const reference = { pay: "Pay {amount}", hello: "Hello" };

  it("reports missing and unknown keys", () => {
    const { errors } = checkCatalogs(reference, { xx: { pay: "P {amount}", extra: "?" } });
    expect(errors).toContain('xx: missing key "hello"');
    expect(errors).toContain('xx: unknown key "extra"');
  });

  it("reports placeholder drift in both directions", () => {
    const { errors } = checkCatalogs(reference, { xx: { pay: "Pay {total}", hello: "Hi {name}" } });
    expect(errors).toHaveLength(2);
    expect(errors).toContain("xx.hello: placeholders {name} do not match en {}");
    expect(errors).toContain("xx.pay: placeholders {total} do not match en {amount}");
  });

  it("reports malformed braces and malformed entries", () => {
    const { errors } = checkCatalogs(reference, { xx: { pay: "Pay {amount", hello: { text: "Hi", needsReview: false } } });
    expect(errors.some((e) => e.includes("xx.pay: malformed placeholder braces"))).toBe(true);
    expect(errors.some((e) => e.includes("xx.hello: must be a string or { text, needsReview: true }"))).toBe(true);
  });

  it("requires English to be reviewed plain strings", () => {
    const { errors } = checkCatalogs({ hello: { text: "Hello", needsReview: true } }, {});
    expect(errors).toEqual(["en.hello: English is the fallback and must be a reviewed plain string"]);
  });

  it("counts drafts per locale", () => {
    const { drafts, errors } = checkCatalogs(reference, {
      xx: { pay: { text: "Pay {amount}", needsReview: true }, hello: "Hi" },
    });
    expect(errors).toEqual([]);
    expect(drafts).toEqual({ xx: ["pay"] });
  });
});

describe("interpolate", () => {
  it("replaces placeholders", () => {
    expect(interpolate("Pay {amount} for {count} items", { amount: "GH₵ 10", count: 2 })).toBe("Pay GH₵ 10 for 2 items");
  });

  it("leaves unknown placeholders visible rather than blank", () => {
    expect(interpolate("Pay {amount}", {})).toBe("Pay {amount}");
  });

  it("does not read inherited properties", () => {
    expect(interpolate("{toString}", {})).toBe("{toString}");
  });

  it("lists placeholders sorted and unique", () => {
    expect(placeholdersOf("{b} {a} {b} {not valid} {1x}")).toEqual(["a", "b"]);
  });
});

describe("dictionary and drafts", () => {
  it("falls back to English for draft keys by default", () => {
    expect(dictionary("pcm").unavailable).toBe(en.unavailable);
    expect(dictionary("tw").shop).toBe(en.shop);
  });

  it("shows drafts only when asked", () => {
    expect(dictionary("pcm", { includeDrafts: true }).unavailable).toBe("E no dey");
    expect(dictionary("tw", { includeDrafts: true }).search).toBe("Hwehwɛ");
  });

  it("returns reviewed French as-is and caches resolved catalogues", () => {
    expect(dictionary("fr-CI").cart).toBe("Panier");
    expect(dictionary("fr")).toBe(dictionary("fr-CI"));
  });

  it("translates with typed params", () => {
    expect(translate("fr", "payAmount", { amount: "5 000 F CFA" })).toBe("Payer 5 000 F CFA");
    expect(translate("en", "shop")).toBe("Shop");
    expect(translate("pcm", "itemsInCart", { count: 3 })).toBe("3 items in your cart");
  });
});

describe("locale resolution", () => {
  it.each([
    ["en-GB", "en"],
    ["fr_CI", "fr"],
    ["pcm", "pcm"],
    ["tw", "tw"],
    ["ak-GH", "tw"],
    ["de", null],
    ["", null],
    ["constructor", null],
  ])("matchLocale(%s) -> %s", (tag, expected) => {
    expect(matchLocale(tag)).toBe(expected);
  });

  it("resolveLocale defaults to English", () => {
    expect(resolveLocale("xx")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("parses Accept-Language by q-value, keeping order on ties and dropping q=0", () => {
    expect(parseAcceptLanguage("de;q=0.5, fr-CI, en;q=0.8, pcm;q=0, *;q=0.1")).toEqual(["fr-CI", "en", "de"]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });

  it("prefers the sd_locale cookie", () => {
    expect(resolveRequestLocale({ cookie: "fr", acceptLanguage: "en-US", country: "GH" })).toBe("fr");
  });

  it("ignores an invalid cookie and uses Accept-Language", () => {
    expect(resolveRequestLocale({ cookie: "zz", acceptLanguage: "de, fr;q=0.9", country: "GH" })).toBe("fr");
  });

  it("falls back to the country default, then English", () => {
    expect(resolveRequestLocale({ acceptLanguage: "de", country: "CI" })).toBe("fr");
    expect(resolveRequestLocale({ country: "NG" })).toBe("en");
    expect(resolveRequestLocale({})).toBe("en");
  });

  it("never defaults a country to a draft locale", () => {
    for (const locale of Object.values(COUNTRY_DEFAULT_LOCALE)) {
      expect(Object.values(MESSAGE_CATALOGS[locale]).some(isDraft)).toBe(false);
    }
  });
});
