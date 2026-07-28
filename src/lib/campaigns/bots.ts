/**
 * Non-human request detection for campaign click recording.
 *
 * WhatsApp is the single most important entry here: it is the dominant sharing
 * channel in Ghana and Nigeria and it fetches every shared URL to build the
 * preview card. Counting those inflates the click number a creator is judged on
 * before a human has seen the link at all.
 *
 * Deliberately conservative. A false positive is invisible and silently
 * underpays a creator, which is far worse than a few over-counted clicks — so
 * this matches obvious automation only, and in-app browsers (TikTok, Instagram,
 * Facebook, Snapchat) must always read as human.
 */
const BOT_PATTERN =
  /(bot|crawler|spider|facebookexternalhit|whatsapp|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|googlebot|bingbot|yandex|duckduckbot|applebot|skypeuripreview|embedly|quora link preview|redditbot|pinterest|vkshare|preview|curl\/|wget|python-requests|go-http-client|axios\/|node-fetch|okhttp|headless|lighthouse|pagespeed|gtmetrix|uptime|monitor)/i;

/**
 * `facebookexternalhit` also serves Instagram link previews, and the in-app
 * browsers report as ordinary mobile Safari/Chrome — which is why matching on
 * "instagram" or "fban"/"fbav" would be wrong here.
 */
export function isNonHumanRequest(input: {
  userAgent: string | null | undefined;
  purpose?: string | null;
  secPurpose?: string | null;
  secFetchMode?: string | null;
}): boolean {
  const userAgent = input.userAgent?.trim();

  // No UA at all is a script, not a browser.
  if (!userAgent) return true;
  if (BOT_PATTERN.test(userAgent)) return true;

  // Browsers warming a link the user has not opened yet.
  const purpose = `${input.purpose ?? ""} ${input.secPurpose ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("preview") || purpose.includes("prerender")) {
    return true;
  }

  // A real click is a top-level navigation. Absent header (older browsers,
  // in-app webviews) is treated as human rather than guessed at.
  const mode = input.secFetchMode?.toLowerCase();
  if (mode && mode !== "navigate") return true;

  return false;
}
