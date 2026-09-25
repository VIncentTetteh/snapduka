import { z } from "zod";

import { generateStructured } from "../../ai/structured";
import type { ModelCaller } from "../../ai/types";

/**
 * First pass over every inbound buyer message: which language, what they want,
 * and whether a person should take it. Runs on Haiku — it is cheap, it runs on
 * every message, and a wrong answer costs one slightly-off reply, not money.
 *
 * Pure (relative imports only, no `server-only`) so the offline eval harness
 * (scripts/eval-wa-agent.mjs) runs exactly this code.
 *
 * The heuristic below is not a stub: it is the fallback when the model is
 * unavailable or returns garbage, and the baseline the eval compares against.
 * It must stay conservative — when unsure it says "needs a human", because a
 * buyer handed to the seller unnecessarily is a small cost and a complaint
 * answered by a bot is a large one.
 */

export const LANGUAGES = ["en", "pcm", "tw"] as const;
export const INTENTS = [
  "greeting",
  "product_question",
  "price_question",
  "availability",
  "delivery",
  "checkout",
  "order_status",
  "complaint",
  "human_request",
  "off_topic",
  "other",
] as const;

export type Language = (typeof LANGUAGES)[number];
export type Intent = (typeof INTENTS)[number];

export const classificationSchema = z.object({
  language: z.enum(LANGUAGES),
  intent: z.enum(INTENTS),
  needsHuman: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type Classification = z.infer<typeof classificationSchema> & { source: "model" | "heuristic" };

/** Below this, the agent does not guess — a person takes it. */
export const LOW_CONFIDENCE = 0.5;

export const CLASSIFIER_SYSTEM_PROMPT = [
  "You classify WhatsApp messages that buyers send to small online shops in Ghana and Nigeria.",
  "Language: en (English), pcm (Nigerian or Ghanaian Pidgin), tw (Twi/Akan). Pick the main language; mixed English/Twi with mostly Twi words is tw.",
  `Intent, one of: ${INTENTS.join(", ")}.`,
  "- complaint: anything about a wrong, late, damaged or missing order, a refund, being cheated, or anger at the shop.",
  "- human_request: the buyer asks for a person, the owner, the seller, customer care, or says they do not want a bot.",
  "- off_topic: unrelated to shopping with this shop (homework, politics, jokes, other businesses).",
  "needsHuman is true for complaints, human requests, refunds, disputes, custom orders or bulk/wholesale negotiation, and anything you are unsure about.",
  "confidence is how sure you are of the intent, 0 to 1.",
  'Reply with only JSON: {"language": ..., "intent": ..., "needsHuman": true|false, "confidence": number}',
].join("\n");

/**
 * Whole-word match that understands Twi letters. JavaScript's \b only knows
 * ASCII word characters, so /\bɛte/ never matches "ɛte sɛn" — the most common
 * Twi greeting would slip through every rule below.
 */
function words(alternatives: string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

const HUMAN_WORDS = words([
  "human", "real person", "agent", "customer (?:care|service)", "the owner",
  "talk to (?:a |the )?(?:person|seller|someone|somebody|owner)", "call me", "onipa",
]);
const COMPLAINT_WORDS = words([
  "refund", "scam", "fraud", "cheat(?:ed)?", "wrong (?:item|size|colou?r)", "damaged", "broken",
  "not (?:arrive|arrived|deliver(?:ed)?)", "never (?:came|arrived)", "where is my (?:order|package|parcel)",
  "complain", "disappoint(?:ed|ing)?", "useless", "nonsense", "wahala", "(?:[ɛe])?y[ɛe] me ya", "mmae da",
]);
const ORDER_WORDS = words(["sd-[a-z0-9]{6,}", "my order", "order (?:status|number)", "track(?:ing)?"]);
const PRICE_WORDS = words([
  "how much", "price", "cost", "[ɛe]y[ɛe] s[ɛe]n", "s[ɛe]n na", "wetin be (?:the )?price", "discount", "last price",
]);
const AVAILABILITY_WORDS = words(["available", "in stock", "you get am", "w[ɔo] w[ɔo] h[ɔo]", "size", "colou?r"]);
const DELIVERY_WORDS = words(["deliver(?:y)?", "ship(?:ping)?", "send am", "bring (?:it|am)", "dispatch", "rider"]);
const CHECKOUT_WORDS = words(["buy", "order (?:it|am|one|two)", "i want (?:it|am|to buy)", "pay", "momo", "checkout"]);
const GREETING_WORDS = new RegExp(
  "^\\s*(?:hi|hello|hey|good (?:morning|afternoon|evening)|[ɛe]te s[ɛe]n|how far|maakye|maaha|maadwo|chale)(?![\\p{L}])",
  "iu",
);

const PIDGIN_MARKERS = words([
  "abeg", "wetin", "dey", "una", "oga", "how far", "make i", "na so", "comot", "wahala", "sabi", "you get am", "abi",
]);
const TWI_MARKERS = words([
  "me pa wo ky[ɛe]w", "medaase", "mepa", "[ɛe]y[ɛe]", "[ɛe]te s[ɛe]n", "maakye", "maaha", "maadwo", "s[ɛe]n na",
  "akwaaba", "[ɛe]he", "nti", "paa", "mesr[ɛe]", "me hia", "me p[ɛe]", "mep[ɛe]", "y[ɛe] me", "w[ɔo] w[ɔo]",
]);

function detectLanguage(text: string): Language {
  if (TWI_MARKERS.test(text)) return "tw";
  if (PIDGIN_MARKERS.test(text)) return "pcm";
  return "en";
}

/** Deterministic fallback. Conservative: complaint and human always escalate. */
export function heuristicClassify(text: string): Classification {
  const language = detectLanguage(text);
  const base = { language, source: "heuristic" as const };
  if (HUMAN_WORDS.test(text)) return { ...base, intent: "human_request", needsHuman: true, confidence: 0.8 };
  if (COMPLAINT_WORDS.test(text)) return { ...base, intent: "complaint", needsHuman: true, confidence: 0.7 };
  if (ORDER_WORDS.test(text)) return { ...base, intent: "order_status", needsHuman: false, confidence: 0.6 };
  if (PRICE_WORDS.test(text)) return { ...base, intent: "price_question", needsHuman: false, confidence: 0.6 };
  if (DELIVERY_WORDS.test(text)) return { ...base, intent: "delivery", needsHuman: false, confidence: 0.6 };
  if (CHECKOUT_WORDS.test(text)) return { ...base, intent: "checkout", needsHuman: false, confidence: 0.6 };
  if (AVAILABILITY_WORDS.test(text)) return { ...base, intent: "availability", needsHuman: false, confidence: 0.55 };
  if (GREETING_WORDS.test(text)) return { ...base, intent: "greeting", needsHuman: false, confidence: 0.7 };
  return { ...base, intent: "other", needsHuman: false, confidence: 0.4 };
}

/**
 * Explicit "get me a person" keywords are honoured without asking any model:
 * a buyer who types HUMAN must reach a human even if every AI call is down.
 */
export function isHandoffKeyword(text: string): boolean {
  return /^\s*(human|agent|person|seller|owner)\s*[.!]?\s*$/i.test(text) || HUMAN_WORDS.test(text);
}

export async function classifyMessage(call: ModelCaller, text: string): Promise<Classification> {
  const result = await generateStructured({
    call,
    schema: classificationSchema,
    request: {
      max_tokens: 200,
      system: CLASSIFIER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: text.slice(0, 2000) }],
    },
  });
  if (!result.ok) return heuristicClassify(text);
  // The model may under-call escalation; the keyword rules may not be overruled.
  const heuristic = heuristicClassify(text);
  const mustEscalate = heuristic.intent === "human_request" || heuristic.intent === "complaint";
  return {
    ...result.data,
    needsHuman: result.data.needsHuman || mustEscalate,
    source: "model",
  };
}

/** Whether this classification sends the conversation to a person. */
export function shouldHandOff(classification: Classification): boolean {
  return (
    classification.needsHuman ||
    classification.intent === "complaint" ||
    classification.intent === "human_request" ||
    classification.confidence < LOW_CONFIDENCE
  );
}
