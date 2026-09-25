// English: the reference catalogue and the runtime fallback for every other
// locale. Every key must exist here, and every value must be a reviewed plain
// string. No imports: scripts/check-i18n.mjs loads this file directly.
export const en = {
  shop: "Shop",
  search: "Search",
  checkout: "Checkout",
  cart: "Cart",
  name: "Name",
  phone: "Phone",
  email: "Email",
  address: "Address",
  delivery: "Delivery",
  pickup: "Pickup",
  pay: "Pay",
  order: "Order",
  total: "Total",
  discount: "Discount",
  unavailable: "Unavailable",
  retry: "Try again",
  loading: "Loading",
  receipt: "Receipt",
  tracking: "Track order",
  payAmount: "Pay {amount}",
  orderReference: "Order {reference}",
  itemsInCart: "{count} items in your cart",
} as const;
