import { Badge, type BadgeTone } from "@/components/ui/badge";

type StatusSpec = { label: string; tone: BadgeTone };

export const PAYMENT_STATUS: Record<string, StatusSpec> = {
  unpaid: { label: "Unpaid", tone: "warn" },
  pending: { label: "Pending", tone: "warn" },
  paid: { label: "Paid", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  partially_refunded: { label: "Partially refunded", tone: "warn" },
  refunded: { label: "Refunded", tone: "neutral" },
  offline_due: { label: "Payment due", tone: "warn" },
};

export const FULFILLMENT_STATUS: Record<string, StatusSpec> = {
  unconfirmed: { label: "New", tone: "accent" },
  confirmed: { label: "Confirmed", tone: "neutral" },
  preparing: { label: "Preparing", tone: "neutral" },
  ready_for_pickup: { label: "Ready for pickup", tone: "neutral" },
  dispatched: { label: "Delivering", tone: "warn" },
  fulfilled: { label: "Fulfilled", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  returned: { label: "Returned", tone: "danger" },
};

export const PRODUCT_STATUS: Record<string, StatusSpec> = {
  active: { label: "Published", tone: "success" },
  draft: { label: "Draft", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },
};

export function PaymentBadge({ status }: { status: string }) {
  const spec = PAYMENT_STATUS[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return <Badge tone={spec.tone}>{spec.label}</Badge>;
}

export function FulfillmentBadge({ status }: { status: string }) {
  const spec = FULFILLMENT_STATUS[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return <Badge tone={spec.tone}>{spec.label}</Badge>;
}

export function ProductStatusBadge({ status, soldOut }: { status: string; soldOut?: boolean }) {
  if (soldOut && status === "active") {
    return <Badge tone="dark">Sold out</Badge>;
  }
  const spec = PRODUCT_STATUS[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return <Badge tone={spec.tone}>{spec.label}</Badge>;
}
