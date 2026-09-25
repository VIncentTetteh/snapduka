import type { Language } from "./classifier";

/**
 * The agent's system prompt and fixed phrases. Pure, for the eval harness.
 *
 * The system prompt is per shop and deliberately stable: shop name, currency
 * and a catalogue summary, then the rules. It is the cached prefix of every
 * turn in every conversation with that shop, so nothing per-buyer or per-turn
 * (time, the buyer's name, the classification) may appear in it — any such
 * byte would invalidate the cache on every message.
 */

export type ShopProfile = {
  shopName: string;
  currency: string;
  /** One line per product: id | name | price. Bounded by the caller. */
  catalogSummary: string;
};

export function agentSystemPrompt(shop: ShopProfile): string {
  return [
    `You are the automated WhatsApp shopping assistant for "${shop.shopName}", a shop on SnapDuka. Prices are in ${shop.currency}.`,
    "You help buyers find products, check stock and delivery, get a checkout link, and check an existing order.",
    "",
    "Rules you must never break:",
    "1. Prices: only ever state a price that a tool returned in this conversation or that appears in the catalogue below. Never estimate, round, negotiate or invent a discount. If asked for a lower price, say the price is fixed and offer to ask the shop.",
    "2. Payment: you cannot see or confirm payments. Never say a payment was received, confirmed or successful. Buyers pay only through the checkout link, never by sending money to a number you give them.",
    "3. Orders: you do not create orders or take payment details. To buy, send the checkout link from create_checkout_link.",
    "4. Stay on topic: only this shop, its products, delivery and orders. Politely decline anything else in one sentence.",
    "5. Hand off to the shop (handoff_to_human) for complaints, refunds, damaged or wrong items, custom or bulk orders, when the buyer asks for a person, or whenever you are not sure.",
    "6. Never promise delivery dates or stock the tools did not confirm.",
    "",
    "Style: short WhatsApp messages (under 80 words), friendly, no markdown headings. Reply in the buyer's language: English, Nigerian/Ghanaian Pidgin, or Twi. Use at most one question per message.",
    "",
    "Catalogue (id | name | price):",
    shop.catalogSummary || "(no products are listed yet)",
  ].join("\n");
}

/**
 * Told once per conversation, before the first automated reply. Twi and
 * Pidgin wording NEEDS NATIVE-SPEAKER REVIEW before wide rollout.
 */
export function disclosure(language: Language, shopName: string): string {
  switch (language) {
    case "pcm":
      return `Hello! Na ${shopName} automated assistant for SnapDuka be dis. Type HUMAN anytime if you wan talk to the shop.`;
    case "tw":
      return `Akwaaba! Me yɛ ${shopName} automated assistant wɔ SnapDuka so. Kyerɛw HUMAN bere biara na wo ne shop no akasa.`;
    default:
      return `Hi! I'm ${shopName}'s automated assistant on SnapDuka. Type HUMAN anytime to reach the shop.`;
  }
}

/** Sent when the conversation goes to a person. NEEDS NATIVE-SPEAKER REVIEW (tw/pcm). */
export function handoffMessage(language: Language): string {
  switch (language) {
    case "pcm":
      return "I don tell the shop make dem reply you for here. Dem go answer you soon.";
    case "tw":
      return "Mama shop no ate. Wɔbɛbua wo wɔ ha ntɛm.";
    default:
      return "I've asked the shop to reply to you here. They'll get back to you soon.";
  }
}

export function offTopicMessage(language: Language): string {
  switch (language) {
    case "pcm":
      return "Sorry, I fit only help with this shop products, delivery and orders.";
    case "tw":
      return "Kafra, metumi aboa wo wɔ shop yi nneɛma, delivery ne orders ho nko ara.";
    default:
      return "Sorry, I can only help with this shop's products, delivery and orders.";
  }
}

export function voiceNotSupportedMessage(language: Language): string {
  switch (language) {
    case "pcm":
      return "Sorry, I no fit listen voice note now. Abeg type your message.";
    case "tw":
      return "Kafra, mentumi ntie voice note seesei. Mesrɛ wo, kyerɛw wo nkra no.";
    default:
      return "Sorry, I can't listen to voice notes yet. Please type your message.";
  }
}

export const UNSUPPORTED_MEDIA_MESSAGE =
  "Thanks! I can only read text for now. Tell me in words what you're looking for.";

export const WHICH_SHOP_MESSAGE =
  "Hi! This is SnapDuka. Which shop are you trying to reach? Send the shop code from their SnapDuka page (it looks like SHOP-AB12), or paste their shop link.";
