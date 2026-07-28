import { describe, expect, it } from "vitest";

import { isNonHumanRequest } from "./bots";

// Real strings, not paraphrases — a regex tuned against invented user agents
// proves nothing.
const HUMAN = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 13; TECNO KG5j) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  tiktokWebview:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_33.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/GH",
  instagramWebview:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 331.0.0.37.90 (iPhone13,2; iOS 17_4; en_US)",
  facebookWebview:
    "Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/456.0.0.32.109;]",
  desktopFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
};

const NON_HUMAN = {
  whatsapp: "WhatsApp/2.24.10.85 A",
  facebookScraper: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  twitter: "Twitterbot/1.0",
  telegram: "TelegramBot (like TwitterBot)",
  slack: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  google: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  curl: "curl/8.4.0",
  python: "python-requests/2.31.0",
  headless: "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/124.0.0.0 Safari/537.36",
};

describe("isNonHumanRequest", () => {
  // The expensive failure: a real creator's audience classified as bots means
  // silent, unfalsifiable underpayment.
  it.each(Object.entries(HUMAN))("treats %s as a human click", (_name, userAgent) => {
    expect(isNonHumanRequest({ userAgent })).toBe(false);
  });

  it.each(Object.entries(NON_HUMAN))("treats %s as non-human", (_name, userAgent) => {
    expect(isNonHumanRequest({ userAgent })).toBe(true);
  });

  it("treats a missing user agent as non-human", () => {
    expect(isNonHumanRequest({ userAgent: null })).toBe(true);
    expect(isNonHumanRequest({ userAgent: "   " })).toBe(true);
  });

  it.each(["prefetch", "prerender", "preview"])("skips %s hints", (hint) => {
    expect(isNonHumanRequest({ userAgent: HUMAN.androidChrome, secPurpose: hint })).toBe(true);
    expect(isNonHumanRequest({ userAgent: HUMAN.androidChrome, purpose: hint })).toBe(true);
  });

  it("skips a non-navigation fetch mode", () => {
    expect(isNonHumanRequest({ userAgent: HUMAN.iosSafari, secFetchMode: "cors" })).toBe(true);
    expect(isNonHumanRequest({ userAgent: HUMAN.iosSafari, secFetchMode: "no-cors" })).toBe(true);
  });

  it("accepts a navigation, and an absent fetch mode", () => {
    expect(isNonHumanRequest({ userAgent: HUMAN.iosSafari, secFetchMode: "navigate" })).toBe(false);
    expect(isNonHumanRequest({ userAgent: HUMAN.iosSafari, secFetchMode: null })).toBe(false);
  });
});
