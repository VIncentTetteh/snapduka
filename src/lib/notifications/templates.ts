export function orderUpdateTemplate(input: { reference: string; status: string; trackingUrl: string }) {
  return {
    subject: `Order ${input.reference}: ${input.status}`,
    text: `Your SnapDuka order is ${input.status}. Track it: ${input.trackingUrl}`,
  };
}

/** The events a creator is told about. */
export type CreatorNotificationEvent =
  | "creator_partnership_accepted"
  | "creator_commission_earned"
  | "creator_payment_recorded";

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
