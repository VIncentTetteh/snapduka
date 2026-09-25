// Twi (Akan, tw).
//
// MACHINE DRAFTS. Every entry is `{ text, needsReview: true }` until a fluent
// speaker approves it by replacing the object with the plain string. Until
// then the runtime shows English for that key (see `dictionary()` in
// ../index.ts), so an unreviewed guess never reaches a buyer by accident.
// No imports: loaded directly by scripts/check-i18n.mjs.
export const tw = {
  shop: { text: "Sotɔɔ", needsReview: true },
  search: { text: "Hwehwɛ", needsReview: true },
  checkout: { text: "Tua ka", needsReview: true },
  cart: { text: "Nneɛma a woatɔ", needsReview: true },
  name: { text: "Din", needsReview: true },
  phone: { text: "Fon nɔma", needsReview: true },
  email: { text: "Email", needsReview: true },
  address: { text: "Wo fie address", needsReview: true },
  delivery: { text: "Yɛde bɛbrɛ wo", needsReview: true },
  pickup: { text: "Bɛfa", needsReview: true },
  pay: { text: "Tua", needsReview: true },
  order: { text: "Order", needsReview: true },
  total: { text: "Ne nyinaa", needsReview: true },
  discount: { text: "Te so", needsReview: true },
  unavailable: { text: "Enni hɔ", needsReview: true },
  retry: { text: "San bɔ mmɔden", needsReview: true },
  loading: { text: "Ɛreba", needsReview: true },
  receipt: { text: "Resiit", needsReview: true },
  tracking: { text: "Hwɛ baabi a w'order no du", needsReview: true },
  payAmount: { text: "Tua {amount}", needsReview: true },
  orderReference: { text: "Order {reference}", needsReview: true },
  itemsInCart: { text: "Nneɛma {count} wɔ wo basket mu", needsReview: true },
} as const;
