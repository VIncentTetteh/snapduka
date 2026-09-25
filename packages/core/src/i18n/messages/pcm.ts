// Nigerian / Ghanaian Pidgin (pcm).
//
// MACHINE DRAFTS. Every entry is `{ text, needsReview: true }` until a fluent
// speaker approves it by replacing the object with the plain string. Until
// then the runtime shows English for that key (see `dictionary()` in
// ../index.ts), so an unreviewed guess never reaches a buyer by accident.
// No imports: loaded directly by scripts/check-i18n.mjs.
export const pcm = {
  shop: { text: "Shop", needsReview: true },
  search: { text: "Find am", needsReview: true },
  checkout: { text: "Checkout", needsReview: true },
  cart: { text: "Basket", needsReview: true },
  name: { text: "Name", needsReview: true },
  phone: { text: "Phone number", needsReview: true },
  email: { text: "Email", needsReview: true },
  address: { text: "Address", needsReview: true },
  delivery: { text: "Delivery", needsReview: true },
  pickup: { text: "Come carry am", needsReview: true },
  pay: { text: "Pay", needsReview: true },
  order: { text: "Order", needsReview: true },
  total: { text: "Total", needsReview: true },
  discount: { text: "Discount", needsReview: true },
  unavailable: { text: "E no dey", needsReview: true },
  retry: { text: "Try am again", needsReview: true },
  loading: { text: "E dey load", needsReview: true },
  receipt: { text: "Receipt", needsReview: true },
  tracking: { text: "Check where your order dey", needsReview: true },
  payAmount: { text: "Pay {amount}", needsReview: true },
  orderReference: { text: "Order {reference}", needsReview: true },
  itemsInCart: { text: "{count} tins dey your basket", needsReview: true },
} as const;
