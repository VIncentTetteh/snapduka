import "server-only";

import { cookies, headers } from "next/headers";

import {
  dictionary,
  LOCALE_COOKIE,
  resolveRequestLocale,
  type CountryCode,
  type Locale,
  type Messages,
} from "@snapduka/core";

/**
 * Web glue for the shared i18n in @snapduka/core. The strings, formatting and
 * resolution rules all live in core (one copy for web and mobile); this file
 * only reads the request.
 *
 * Order: explicit `sd_locale` cookie, then Accept-Language, then the country
 * default (CI -> fr, GH/NG -> en), then English.
 */
export async function getRequestLocale(country?: CountryCode | null): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveRequestLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
    country,
  });
}

/**
 * Whether machine-drafted (needsReview) strings may be shown. Only for
 * translators reviewing a preview deployment; production leaves it unset so
 * draft keys fall back to English.
 */
export function showDraftTranslations(): boolean {
  return process.env.I18N_SHOW_DRAFTS === "true";
}

/** Messages for the current request. */
export async function getRequestMessages(country?: CountryCode | null): Promise<Messages> {
  return dictionary(await getRequestLocale(country), { includeDrafts: showDraftTranslations() });
}
