/**
 * Checks on the agent's reply before it is sent. Pure, for the eval harness.
 *
 * The system prompt tells the model the rules; these enforce the two that cost
 * real money when broken, on the final text, regardless of what the model
 * believed. A reply that fails is not sent: the buyer gets the handoff message
 * and the seller gets the conversation.
 */

const CURRENCY = String.raw`(?:GH₵|GHS|GH¢|₵|¢|NGN|₦|N(?=\d)|CFA|XOF|FCFA)`;
const AMOUNT = String.raw`\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const MONEY_PATTERN = new RegExp(
  String.raw`${CURRENCY}\s?(${AMOUNT})|(${AMOUNT})\s?(?:cedis?|naira|${CURRENCY})`,
  "giu",
);

function toValue(amount: string): number {
  return Number(amount.replace(/[,\s]/g, ""));
}

/** Every money amount in a text, as numbers in major units. */
export function moneyAmounts(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(MONEY_PATTERN)) {
    const amount = match[1] ?? match[2];
    if (amount) values.push(toValue(amount));
  }
  return values;
}

/**
 * Amounts in the reply that no tool returned and the catalogue does not list.
 * "Never quote prices other than catalog/promotions" as a check, not a hope:
 * a model that rounds GH₵ 119.99 to GH₵ 120, or invents a discount to close a
 * sale, commits the seller to a price they never set.
 */
export function unverifiedPrices(reply: string, allowedPriceTexts: string[]): number[] {
  const allowed = new Set(allowedPriceTexts.flatMap((text) => moneyAmounts(text)));
  return moneyAmounts(reply).filter((value) => !allowed.has(value));
}

const PAYMENT_CLAIM = new RegExp(
  [
    String.raw`payment\s+(?:has\s+been\s+|was\s+|is\s+)?(?:received|confirmed|successful|complete[d]?|approved)`,
    String.raw`(?:we|i)\s+(?:have\s+)?(?:received|got|confirmed)\s+(?:your\s+)?(?:payment|money|momo)`,
    String.raw`you(?:'ve|\s+have)?\s+paid\s+successfully`,
    String.raw`paid\s+successfully`,
    String.raw`your\s+order\s+is\s+paid`,
  ].join("|"),
  "i",
);

/**
 * Only webhooks confirm payment. A buyer who says "I have sent the money" and
 * hears "payment received" from us has been defrauded by our own bot if the
 * money never came — so the agent may say an order is paid only when
 * get_order_status said so in this very turn.
 */
export function claimsPayment(reply: string): boolean {
  return PAYMENT_CLAIM.test(reply);
}

export type GuardrailVerdict = { ok: true } | { ok: false; violation: "unverified_price" | "payment_claim" };

export function checkReply(
  reply: string,
  context: { allowedPriceTexts: string[]; paidOrderConfirmed: boolean },
): GuardrailVerdict {
  if (unverifiedPrices(reply, context.allowedPriceTexts).length > 0) {
    return { ok: false, violation: "unverified_price" };
  }
  if (!context.paidOrderConfirmed && claimsPayment(reply)) return { ok: false, violation: "payment_claim" };
  return { ok: true };
}
