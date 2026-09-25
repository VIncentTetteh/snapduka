/**
 * SMS as a broadcast channel: segment arithmetic and the opt-out footer.
 *
 * Every marketing SMS ends with an instruction to opt out. It goes out from
 * the one shared sender ID, so a buyer has no other way to stop hearing from
 * it, and a marketing SMS without one is a compliance problem, not a style
 * choice. The inbound side (STOP/START) is /api/sms/inbound/[provider].
 *
 * Length is budgeted in *segments*, not characters, because that is what the
 * provider bills and what the handset reassembles:
 *   - GSM-7 (the default alphabet): 160 septets in one SMS, 153 per part once
 *     split (the rest is the concatenation header). A handful of characters —
 *     ^ { } \ [ ] ~ | € — are escape sequences and cost two.
 *   - Anything outside GSM-7 (an emoji, most accented letters, curly quotes)
 *     switches the WHOLE message to UCS-2: 70 per SMS, 67 per part. One emoji
 *     roughly halves what fits.
 * The body is truncated so body + footer fits in two segments in whichever
 * encoding the message actually needs. Two, not three: most Ghanaian and
 * Nigerian handsets reassemble two parts reliably, and the footer must never
 * be the part that goes missing.
 */

export const SMS_OPT_OUT_FOOTER = "Reply STOP to opt out";
export const SMS_BROADCAST_MAX_SEGMENTS = 2;

const GSM_SINGLE = 160;
const GSM_MULTIPART = 153;
const UCS2_SINGLE = 70;
const UCS2_MULTIPART = 67;
/** GSM-7 rather than "…": the ellipsis character alone would force UCS-2. */
const TRUNCATION_MARK = "...";

// GSM 03.38 default alphabet (the escape character itself excluded).
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
// Extension table: each costs two septets (escape + char).
const GSM_EXTENDED = new Set("^{}\\[~]|€\f");

export type SmsEncoding = "gsm7" | "ucs2";

export function smsEncoding(text: string): SmsEncoding {
  for (const char of text) {
    if (!GSM_BASIC.has(char) && !GSM_EXTENDED.has(char)) return "ucs2";
  }
  return "gsm7";
}

/** Septets for GSM-7; UTF-16 code units for UCS-2 (an emoji is two). */
export function smsUnits(text: string, encoding: SmsEncoding = smsEncoding(text)): number {
  if (encoding === "ucs2") return text.length;
  let units = 0;
  for (const char of text) units += GSM_EXTENDED.has(char) ? 2 : 1;
  return units;
}

export function smsSegmentCount(text: string): number {
  const encoding = smsEncoding(text);
  const units = smsUnits(text, encoding);
  const [single, multipart] = encoding === "gsm7" ? [GSM_SINGLE, GSM_MULTIPART] : [UCS2_SINGLE, UCS2_MULTIPART];
  if (units === 0) return 0;
  return units <= single ? 1 : Math.ceil(units / multipart);
}

function maxUnits(encoding: SmsEncoding, segments: number): number {
  if (encoding === "gsm7") return segments === 1 ? GSM_SINGLE : GSM_MULTIPART * segments;
  return segments === 1 ? UCS2_SINGLE : UCS2_MULTIPART * segments;
}

function withFooter(body: string): string {
  return body ? `${body} ${SMS_OPT_OUT_FOOTER}` : SMS_OPT_OUT_FOOTER;
}

/**
 * The text actually sent for a marketing SMS: whitespace collapsed (bodies are
 * often written for email), truncated to fit, footer always last and whole.
 */
export function smsBroadcastBody(body: string): string {
  const text = body.replace(/\s+/g, " ").trim();
  const full = withFooter(text);
  // The encoding of the full message decides the budget: one UCS-2 character
  // anywhere changes the arithmetic for all of it.
  const encoding = smsEncoding(full);
  const limit = maxUnits(encoding, SMS_BROADCAST_MAX_SEGMENTS);
  if (smsUnits(full, encoding) <= limit) return full;

  const reserved = smsUnits(` ${TRUNCATION_MARK} ${SMS_OPT_OUT_FOOTER}`, encoding) - 1;
  let kept = "";
  let used = 0;
  // By code point, so an emoji is never cut in half into an unpaired surrogate.
  for (const char of text) {
    const cost = smsUnits(char, encoding);
    if (used + cost > limit - reserved) break;
    kept += char;
    used += cost;
  }
  return withFooter(`${kept.trimEnd()}${TRUNCATION_MARK}`);
}
