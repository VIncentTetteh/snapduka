/**
 * SnapDuka Protect, the parts both web and mobile need: the fee a buyer sees
 * before paying, and what each protection state means to the people involved.
 *
 * The fee rule mirrors `public.protect_fee_for` (202609250106). The database is
 * authoritative — it computes the fee that is actually charged — so this copy
 * exists only to show the buyer the same number before they tap "Pay".
 */

export const PROTECT_STATES = [
  "held",
  "in_transit",
  "releasable",
  "released",
  "disputed",
  "refunded",
  "cancelled",
] as const;

export type ProtectState = (typeof PROTECT_STATES)[number];

export type ProtectFeePolicy = {
  feeBps: number;
  minMinor: number;
  capMinor: number;
};

/** Buyer-paid Protect fee on goods + delivery, in minor units. Integer maths, floors like SQL. */
export function protectFeeMinor(amountMinor: number, policy: ProtectFeePolicy): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError("amountMinor must be a non-negative integer");
  }
  const raw = Math.floor((amountMinor * policy.feeBps) / 10000);
  return Math.min(Math.max(raw, policy.minMinor), policy.capMinor);
}

/** Plain-language status for the buyer. Never mentions the seller's money. */
export const PROTECT_BUYER_COPY: Record<ProtectState, string> = {
  held: "Your payment is held safely. The seller is paid only after you receive your order.",
  in_transit: "On its way. Give your delivery code to the rider only when you have your order.",
  releasable: "Delivered. Tell us within the inspection window if anything is wrong.",
  released: "Complete. The seller has been paid.",
  disputed: "We are looking into your report. Your payment stays held until it is resolved.",
  refunded: "Resolved in your favour. Your refund is on its way.",
  cancelled: "Cancelled. Your payment is being returned.",
};

/** Plain-language status for the seller. */
export const PROTECT_SELLER_COPY: Record<ProtectState, string> = {
  held: "Paid with Protect. Dispatch to start delivery; you are paid after the buyer confirms.",
  in_transit: "Out for delivery. The buyer's delivery code confirms it; otherwise it confirms automatically.",
  releasable: "Delivered. Your money moves to your balance after the inspection and hold periods.",
  released: "Paid out to your balance.",
  disputed: "The buyer reported a problem. Your payment is on hold while SnapDuka reviews it.",
  refunded: "Refunded to the buyer after review.",
  cancelled: "Cancelled before delivery.",
};

export function isProtectState(value: string): value is ProtectState {
  return (PROTECT_STATES as readonly string[]).includes(value);
}
