/**
 * Recognising STOP / START in an inbound SMS.
 *
 * Opt-out is matched on the FIRST word, case-insensitively and ignoring
 * punctuation, so "Stop.", "stop please" and "STOP SENDING ME THIS" all stop.
 * Being generous here is the safe direction: a false positive costs one buyer
 * the promotions they could re-subscribe to; a false negative is a buyer who
 * asked to be left alone and was not.
 *
 * Opt-in is the opposite: only a message that is START and nothing else
 * re-subscribes. "start my order again" or "Start delivery tomorrow?" sent to
 * the shared sender must not silently undo someone's STOP.
 */

export const OPT_OUT_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"] as const;
export const OPT_IN_KEYWORDS = ["START"] as const;

export type SmsKeywordAction = "opt_out" | "opt_in" | "ignored";

export type SmsKeyword = { action: SmsKeywordAction; keyword: string | null };

const OPT_OUT = new Set<string>(OPT_OUT_KEYWORDS);
const OPT_IN = new Set<string>(OPT_IN_KEYWORDS);

function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
}

export function classifySmsKeyword(text: string): SmsKeyword {
  const all = words(text ?? "");
  const first = all[0];
  if (!first) return { action: "ignored", keyword: null };
  if (OPT_OUT.has(first)) return { action: "opt_out", keyword: first };
  if (all.length === 1 && OPT_IN.has(first)) return { action: "opt_in", keyword: first };
  return { action: "ignored", keyword: null };
}

/**
 * E.164 from what a provider sends ("233201234567", "+233 20 123 4567",
 * "00233201234567"). Null for a local-format number ("0201234567"): a shared
 * sender serves several countries, and guessing the country would opt out a
 * stranger's number.
 */
export function normalizeSmsPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // A single leading zero is a trunk prefix (local format); "00" is the
  // international prefix and is fine.
  if (/^0(?!0)/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  const e164 = `+${digits}`;
  return /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164 : null;
}
