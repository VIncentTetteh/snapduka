import type { CountryCode, CurrencyCode } from "../countries/types";

import { entryText, interpolate, isDraft, type MessageEntry, type MessageParams } from "./icu-lite";
import { en } from "./messages/en";
import { fr } from "./messages/fr";
import { pcm } from "./messages/pcm";
import { tw } from "./messages/tw";

// The single source of UI strings for web and mobile. Catalogues live in
// ./messages/*.ts (one plain object each, no imports) and are checked by
// scripts/check-i18n.mjs in CI: same keys as English, same `{placeholders}`,
// and a count of machine drafts still awaiting review.

export { checkCatalogs, interpolate, isDraft, placeholdersOf } from "./icu-lite";
export type { CatalogCheck, DraftMessage, MessageEntry, MessageParams, ReviewedMessage } from "./icu-lite";

export const LOCALES = ["en", "fr", "pcm", "tw"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export type MessageKey = keyof typeof en;
export type Messages = { readonly [K in MessageKey]: string };
type Catalog = { readonly [K in MessageKey]: MessageEntry };

// `satisfies` makes a locale that is MISSING a key a compile error. Extra keys
// are caught by checkCatalogs (CI + tests), since a variable reference is not
// subject to excess-property checks.
const CATALOGS = { en, fr, pcm, tw } satisfies Record<Locale, Catalog>;

/** Raw catalogues including draft markers, for the checker and tooling. */
export const MESSAGE_CATALOGS: Readonly<Record<Locale, Catalog>> = CATALOGS;

/** Cookie holding an explicit locale choice on the web. */
export const LOCALE_COOKIE = "sd_locale";

/**
 * Locale a country gets when the request says nothing usable. Pidgin and Twi
 * are never defaults while their strings are machine drafts.
 */
export const COUNTRY_DEFAULT_LOCALE: Readonly<Record<CountryCode, Locale>> = {
  GH: "en",
  NG: "en",
  CI: "fr",
};

/** Primary-subtag aliases. Akan ("ak") is the ISO 639-1 umbrella Twi sits under. */
const LANGUAGE_ALIASES: Readonly<Record<string, Locale>> = {
  en: "en",
  fr: "fr",
  pcm: "pcm",
  tw: "tw",
  twi: "tw",
  ak: "tw",
};

/** Map a BCP 47 tag ("fr-CI", "en_GB", "pcm") to a supported locale, or null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return Object.hasOwn(LANGUAGE_ALIASES, primary) ? (LANGUAGE_ALIASES[primary] ?? null) : null;
}

/** Like matchLocale, but anything unsupported becomes English. */
export function resolveLocale(tag: string | null | undefined): Locale {
  return matchLocale(tag) ?? DEFAULT_LOCALE;
}

/** Language tags from an Accept-Language header, highest q first; q=0 dropped. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.tag !== "" && entry.tag !== "*" && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag);
}

/**
 * Locale for a web request: an explicit `sd_locale` cookie wins, then the
 * first supported Accept-Language entry, then the shop/seller country's
 * default, then English.
 */
export function resolveRequestLocale(input: {
  cookie?: string | null;
  acceptLanguage?: string | null;
  country?: CountryCode | null;
}): Locale {
  const fromCookie = matchLocale(input.cookie);
  if (fromCookie) return fromCookie;
  for (const tag of parseAcceptLanguage(input.acceptLanguage)) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return input.country ? COUNTRY_DEFAULT_LOCALE[input.country] : DEFAULT_LOCALE;
}

export type DictionaryOptions = {
  /**
   * Show machine drafts instead of falling back to English. Off by default;
   * turn on only for reviewers (web: I18N_SHOW_DRAFTS=true).
   */
  includeDrafts?: boolean;
};

const resolvedCache = new Map<string, Messages>();

function resolveCatalog(locale: Locale, includeDrafts: boolean): Messages {
  if (locale === "en") return en;
  const cacheKey = `${locale}:${includeDrafts ? "drafts" : "reviewed"}`;
  const cached = resolvedCache.get(cacheKey);
  if (cached) return cached;
  const catalog: Catalog = CATALOGS[locale];
  const out = {} as Record<MessageKey, string>;
  for (const key of Object.keys(en) as MessageKey[]) {
    const entry = catalog[key];
    out[key] = isDraft(entry) && !includeDrafts ? en[key] : entryText(entry);
  }
  const frozen = Object.freeze(out);
  resolvedCache.set(cacheKey, frozen);
  return frozen;
}

/**
 * All messages for a locale tag. Unsupported tags get English; keys still
 * marked needsReview get the English string unless `includeDrafts` is set.
 */
export function dictionary(locale: string, options: DictionaryOptions = {}): Messages {
  return resolveCatalog(resolveLocale(locale), options.includeDrafts === true);
}

/** Placeholder names in an English template literal type: "Pay {amount}" -> "amount". */
type PlaceholdersOf<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PlaceholdersOf<Rest>
  : never;

export type ParamsFor<K extends MessageKey> = [PlaceholdersOf<(typeof en)[K]>] extends [never]
  ? MessageParams | undefined
  : Readonly<Record<PlaceholdersOf<(typeof en)[K]>, string | number>>;

/** One message, interpolated. `params` is typed from the English template. */
export function translate<K extends MessageKey>(
  locale: string,
  key: K,
  params?: ParamsFor<K>,
  options: DictionaryOptions = {},
): string {
  return interpolate(dictionary(locale, options)[key], params ?? {});
}

export function formatMoney(minor: number, currency: CurrencyCode, locale = "en-GH") {
  const digits = currency === "XOF" ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(currency === "XOF" ? minor : minor / 100);
}

export function normalizePhone(value: string, country: CountryCode) {
  const config = { GH: "+233", NG: "+234", CI: "+225" }[country];
  const national = value.replace(/\D/g, "");
  const digits = country === "CI" ? national : national.replace(/^0/, "");
  return value.trim().startsWith("+")
    ? `+${value.replace(/\D/g, "")}`
    : `${config}${digits}`;
}
