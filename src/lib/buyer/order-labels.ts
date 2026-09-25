import type { BadgeTone } from "@/components/ui/badge";

/**
 * Buyer-facing wording for an order's state in the cross-shop list. The same
 * words the tracking page uses (src/app/orders/[token]/page.tsx), so a buyer
 * who taps through sees the status they were just shown.
 */
const FULFILLMENT: Record<string, { label: string; tone: BadgeTone }> = {
  unconfirmed: { label: "Awaiting seller confirmation", tone: "warn" },
  confirmed: { label: "Confirmed by seller", tone: "accent" },
  preparing: { label: "Being prepared", tone: "accent" },
  ready_for_pickup: { label: "Ready for pickup", tone: "success" },
  dispatched: { label: "On the way", tone: "accent" },
  fulfilled: { label: "Received", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  returned: { label: "Returned", tone: "neutral" },
};

const PAYMENT: Record<string, string> = {
  unpaid: "Payment not received",
  pending: "Payment confirmation pending",
  paid: "Paid",
  failed: "Payment failed",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  offline_due: "Pay the seller",
};

export function fulfillmentBadge(status: string): { label: string; tone: BadgeTone } {
  return FULFILLMENT[status] ?? { label: "In progress", tone: "neutral" };
}

export function paymentLabel(status: string): string {
  return PAYMENT[status] ?? "";
}

/** Same formatting as the tracking page, so amounts read identically on both. */
export function formatOrderTotal(minor: number, currency: string): string {
  if (currency === "XOF") return `${currency} ${minor.toLocaleString("en-US")}`;
  return `${currency} ${(minor / 100).toFixed(2)}`;
}
