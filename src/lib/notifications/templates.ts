/**
 * Protect milestones arrive as event names (protect_held, …), which read as
 * gibberish in "Your SnapDuka order is protect_held". Each gets a sentence.
 * Plain order statuses keep the original wording.
 */
const PROTECT_PHRASES: Record<string, { subject: string; text: string }> = {
  protect_held: { subject: "payment held safely", text: "Your payment is held safely with SnapDuka Protect. The seller is paid only after you receive your order." },
  protect_delivered: { subject: "delivered", text: "Your order was confirmed as delivered. If anything is wrong, report it from your tracking page before the inspection window ends." },
  protect_released: { subject: "complete", text: "Your protected order is complete." },
  protect_disputed: { subject: "problem reported", text: "A problem was reported on this order. The payment stays held while SnapDuka reviews it." },
  protect_dispute_resolved: { subject: "review finished", text: "SnapDuka has finished reviewing the problem reported on this order." },
  protect_dispatch_overdue: { subject: "not yet dispatched", text: "This protected order has not been dispatched yet. SnapDuka is following up; your payment stays held." },
  protect_unheld: { subject: "needs attention", text: "SnapDuka is reviewing the payment on this order." },
  chargeback_opened: { subject: "card chargeback opened", text: "A card chargeback was opened on this order. The related funds are on hold." },
  chargeback_resolved: { subject: "card chargeback resolved", text: "The card chargeback on this order has been resolved." },
};

export function orderUpdateTemplate(input: { reference: string; status: string; trackingUrl: string }) {
  const protect = PROTECT_PHRASES[input.status];
  if (protect) {
    return {
      subject: `Order ${input.reference}: ${protect.subject}`,
      text: `${protect.text} Track it: ${input.trackingUrl}`,
    };
  }
  return {
    subject: `Order ${input.reference}: ${input.status}`,
    text: `Your SnapDuka order is ${input.status}. Track it: ${input.trackingUrl}`,
  };
}

/** The events a creator is told about. */
export type CreatorNotificationEvent =
  | "creator_partnership_accepted"
  | "creator_commission_earned"
  | "creator_commission_payable"
  | "creator_payment_recorded"
  | "creator_wallet_available";

/**
 * What a creator hears from SnapDuka.
 *
 * Until now: nothing. No creator was notified of an accepted partnership, a
 * commission, or a payment — while the seller's dashboard told the seller "the
 * creator has been notified" after recording one. A creator only found out money
 * had moved by happening to open the portal.
 *
 * Every message names the shop, because a creator works with several and "you
 * earned GHS 40" from an unnamed shop is not actionable. Amounts arrive
 * pre-formatted from the caller, which already knows the currency.
 */
export function creatorUpdateTemplate(input: {
  event: CreatorNotificationEvent;
  shopName: string;
  amount?: string;
  portalUrl: string;
}) {
  switch (input.event) {
    case "creator_partnership_accepted":
      return {
        subject: `You are now promoting ${input.shopName}`,
        text: `You are set up with ${input.shopName} on SnapDuka. Make your link and start posting: ${input.portalUrl}/links`,
      };
    case "creator_commission_earned":
      return {
        subject: `You earned ${input.amount} from ${input.shopName}`,
        text: `Someone bought through your link. You earned ${input.amount} from ${input.shopName}. See it: ${input.portalUrl}`,
      };
    case "creator_commission_payable":
      // The hold clock has run out. Deliberately does not say the money is on
      // its way: SnapDuka does not move it, the seller does, and this is the
      // creator's cue to expect it rather than a promise that it has been sent.
      return {
        subject: `${input.amount} from ${input.shopName} is ready to be paid`,
        text: `Your ${input.amount} from ${input.shopName} has cleared its holding period and is ready for them to pay. See it: ${input.portalUrl}`,
      };
    case "creator_wallet_available":
      // Ledger payouts only (202609250202): here SnapDuka does hold the money,
      // so saying it is in their balance is exactly what happened.
      return {
        subject: `${input.amount} from ${input.shopName} is in your SnapDuka balance`,
        text: `Your ${input.amount} from ${input.shopName} is now in your SnapDuka balance, ready to withdraw: ${input.portalUrl}/payments`,
      };
    case "creator_payment_recorded":
      // Deliberately "says they paid you": SnapDuka records the seller's
      // assertion and does not move the money, so claiming it arrived would be
      // more than we know.
      return {
        subject: `${input.shopName} says they paid you ${input.amount}`,
        text: `${input.shopName} has recorded a payment of ${input.amount} to you. Confirm you received it, or raise it with them: ${input.portalUrl}/payments`,
      };
  }
}

/** Seller messages about SnapDuka Capital (stock financing). */
export type SellerFinanceEvent = "financing_disbursed" | "financing_repaid";

export function sellerFinanceTemplate(input: { event: SellerFinanceEvent; amount?: string; dashboardUrl: string }) {
  switch (input.event) {
    case "financing_disbursed":
      return {
        subject: `Your SnapDuka Capital advance${input.amount ? ` of ${input.amount}` : ""} has arrived`,
        text: `Your advance${input.amount ? ` of ${input.amount}` : ""} is in your SnapDuka balance. Repayments come out of your sales automatically. Details: ${input.dashboardUrl}/capital`,
      };
    case "financing_repaid":
      return {
        subject: "Your SnapDuka Capital advance is fully repaid",
        text: `Your advance is fully repaid — nothing more comes out of your sales. See what you qualify for next: ${input.dashboardUrl}/capital`,
      };
  }
}
