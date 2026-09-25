/**
 * Every rollout switch the product knows about. Keys are the contract between
 * the `feature_flags` table and the code: evaluating a key that is not listed
 * here is a type error, so a typo cannot silently read as "off".
 *
 * Per-provider and per-courier flags use a `prefix:id` form so a single
 * integration can be switched off without touching the others.
 */
export const FLAG_KEYS = [
  "protect",
  // The trust-led landing page, switched on per market with Protect.
  "new_homepage",
  "ledger_settlement",
  "instant_payout",
  "wa_agent",
  "wa_agent_voice",
  "wa_outbound",
  "snap_to_list",
  "kyc_auto",
  "buyer_accounts",
  "creator_marketplace",
  "trust_score",
  "seller_digest",
  "sms_broadcasts",
  "ai_captions",
  "product_categories",
  // Evaluated per seller in SQL (accrue_creator_commission) at the moment a
  // commission accrues, and recorded on the commission row, so turning it off
  // never re-routes a commission already in flight.
  "creator_ledger_payouts",
  // Financial products and ads (ADR-0014). stock_financing and bnpl also need
  // a contracted partner; promoted_listings is gated at ~10k weekly active
  // sellers and is evaluated per advertiser in SQL (sponsored_listings).
  "stock_financing",
  "bnpl",
  "promoted_listings",
  // Custom domains verify by TXT record, but nothing yet attaches a verified
  // domain to the hosting project, so it cannot serve the shop. Off until it
  // can; while off, the feature is neither sold nor offered.
  "custom_domains",
] as const;

export type StaticFlagKey = (typeof FLAG_KEYS)[number];
export type FlagKey = StaticFlagKey | `courier_booking:${string}` | `provider:${string}`;

const DYNAMIC_PREFIXES = ["courier_booking:", "provider:"] as const;

export function isFlagKey(value: string): value is FlagKey {
  return (
    (FLAG_KEYS as readonly string[]).includes(value) ||
    DYNAMIC_PREFIXES.some((prefix) => value.startsWith(prefix) && value.length > prefix.length)
  );
}

/** Flags resolved for one seller, as sent to clients. Missing means off. */
export type FlagSnapshot = Partial<Record<StaticFlagKey, boolean>>;
