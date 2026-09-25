# ADR-0007: One buyer identity across shops

**Status**: Proposed
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Context

Every SnapDuka buyer is a guest. An order carries a `buyer_snapshot` (name,
email, phone, address) and a `tracking_token`; `customers` is one row per
(seller, email). A buyer who orders from three shops is three unrelated
customers, sees three unrelated tracking links, and types their address three
times. The roadmap's Phase 3 targets (a quarter of Protect orders from
signed-in buyers, a tenth of buyers ordering from more than one shop) need one
identity that follows the buyer from shop to shop.

Two things constrain the design:

- **Sellers must never see another shop's buyers.** A buyer network that let a
  seller look up what a customer bought elsewhere would be a data-protection
  breach and a competitive leak between our own customers.
- **The Data Protection Act, 2012 (Act 843)** governs this processing in Ghana.
  Combining one person's orders from separate businesses into a single profile
  is a new purpose. The shop the buyer ordered from did not tell them about it,
  so it needs its own lawful basis. Consent is the one we can show.

## Decision

A **buyer profile keyed on a verified phone number**, behind the flag
`buyer_accounts` (default off, Ghana first). Migration `202609250170`.

- **Identity.** Buyers sign in with a phone OTP through Supabase Auth. The
  code goes out through the existing Send-SMS hook (`/api/auth/sms-hook` →
  Techieszon), and the per-number send limit is shared with seller login.
  `bootstrap_buyer_profile()` creates the profile only once
  `auth.users.phone_confirmed_at` is set. A seller who signed in by email can
  attach a phone to the same login (`phone_change`), so one person has one login.
- **Actor.** `resolveBuyerActor()` exists alongside `resolveActor()`, and
  `resolveActor()` does not change. A user can be both a seller and a buyer, and
  every dashboard guard still sees a seller. Buyer context is resolved only on
  buyer routes. Tests assert this for every existing actor kind.
- **Data.** There are three new tables: `buyer_profiles`, `buyer_addresses`
  (shaped like Squad C's `DeliveryAddress`) and `buyer_payment_methods`. Payment
  tokens are sealed with the same AES-256-GCM format as `social_accounts`, under
  a separate key (`BUYER_PAYMENT_TOKEN_KEY`). No client can read them, including
  the owner. `orders` and `customers` each gain a nullable **single-column**
  `buyer_profile_id` FK. There are no composite FKs, because of the PGRST201
  outage (202609050084).
- **Isolation.** RLS on the buyer tables is owner-only. No seller, team or
  operator policy exists on any of them. Everything that crosses shops goes
  through SECURITY DEFINER functions that resolve the caller from `auth.uid()`
  and return an explicit column list. That covers claiming, linking, history,
  export and erasure. We deliberately did not add a buyer policy on `orders`: a
  column added to `orders` later must not become buyer-visible by default.
- **Consent.** Nothing is claimed or linked until the buyer consents to the
  displayed text. `consent_shared_profile_at` and `consent_version` record that
  consent, and the audit trail records it too. Withdrawing consent unlinks
  every order.
- **Claiming.** `claim_guest_orders()` links orders from the last 180 days
  whose normalised snapshot phone equals the verified phone. At checkout,
  `link_order_to_buyer()` is service-role only. It runs after the order has
  committed, links only an order under 15 minutes old, and requires the phone
  to match. A signed-in session on a shared phone therefore cannot pull someone
  else's order into its history. The `create_guest_order*`, totals, stock and
  payment code are unchanged.
- **Erasure.** `request_buyer_deletion()` finishes immediately. It unlinks
  orders and customers, deletes addresses and payment methods, and scrubs the
  profile's phone and name. The audit event is the record. We did not use
  `account_deletion_requests`: that table is the seller path (`seller_account_id
  NOT NULL`, a one-open-request exclusion keyed on it, "close the shop"
  semantics). Buyer erasure also removes no financial record, so nothing needs
  a retention queue.

## Consequences

### Positive
- A buyer sees orders from every shop in one place (`/me/orders`), and checkout
  can be prefilled across shops without the storefront page reading cookies.
- A seller's view of a buyer is unchanged: their own orders' `buyer_snapshot`,
  as before. pgTAP `070` proves no buyer row is readable by a shop owner, a team
  member, a suspended seller, or a seller who is also a buyer.
- The access (JSON export), withdrawal and erasure rights under Act 843 are
  self-service.

### Negative
- `orders.buyer_profile_id` and `customers.buyer_profile_id` can be read by the
  shop that owns the row, because their table-level `select` grants include
  them. Hiding the columns would mean replacing table-level grants on two hot
  tables with column lists that every future migration must maintain. The ids
  are opaque and resolve to nothing a seller can read. Two colluding sellers
  could correlate a buyer across shops with them, but they can already do that
  with the phone number in `buyer_snapshot`.
- `buyer_profiles` and `buyer_addresses` reference each other
  (`default_address_id`). An unhinted PostgREST embed between them is
  ambiguous (PGRST201). No code embeds them, and it must use
  `buyer_addresses!buyer_addresses_buyer_profile_id_fkey` if it ever does.
- Claiming uses an expression index on `orders`. Built without `CONCURRENTLY`,
  it blocks writes to `orders` for the length of the build. This is fine at
  today's size, but the index should be built concurrently by hand if
  production has grown by launch.

### Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Recycled SIM: a new holder of a number inherits the previous owner's orders | Med | High | 180-day claim window; claims require a fresh OTP on the number; the buyer can withdraw consent, which unlinks everything; claims are audited with order ids for support to reverse |
| A seller reaches buyer data through a new query or embed | Low | High | Owner-only RLS with no seller policy; pgTAP 070 asserts no `buyer_*` policy mentions seller/team/operator; history and export only through definer functions with explicit columns |
| A shared device links another person's order at checkout | Med | Med | `link_order_to_buyer` requires the order's phone to equal the profile's verified phone and the order to be under 15 minutes old |
| Consent recorded against wording the buyer never saw | Low | Med | Consent carries a version; the form posts the version it displayed and a mismatch is refused |
| SMS pumping through the buyer sign-in page | Med | Med | IP limit plus the per-number limit shared with seller login; allowance refunded only when no SMS was sent |
| Leak of a saved payment token | Low | High | Sealed with its own key, never granted to any client role, never exported |
| SQL and TS phone normalisers drift apart, so claims silently miss orders | Low | Med | Same vectors pinned in pgTAP 071 and `src/lib/buyer/phone-parity.test.ts` |

### Open questions
- Whether a buyer mobile app is a `(buyer)` route group in the existing Expo
  app or a separate app. `/api/buyer/*` accepts a Bearer JWT, so either works.
- Registration with the Data Protection Commission as a controller for the
  combined profile, and the retention period for `audit_events` rows that name
  a deleted profile id. Legal to confirm before we switch the flag on.
- Saving MoMo and card authorisations needs the Paystack reusable-authorisation
  flow. `saveBuyerPaymentMethod()` is where that flow will store them, and
  nothing calls it yet.
