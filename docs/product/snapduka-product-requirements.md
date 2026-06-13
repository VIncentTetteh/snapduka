# SnapDuka Product Requirements Document

**Status:** Approved product direction

**Version:** 1.0

**Date:** 2026-06-12

**Owner:** Vincent Tetteh

**Markets:** Ghana and Nigeria

**Primary surface:** Mobile web and installable Progressive Web App (PWA)

**North-star metric:** Completed orders

## 1. Executive Summary

SnapDuka is a mobile-first social-commerce operating system for solo sellers
who find customers through Snapchat, TikTok, Instagram, WhatsApp, and similar
social channels. It gives each seller a fast public storefront, trusted
checkout, payment collection, order and fulfillment tools, customer follow-up,
and practical growth insights without requiring traditional e-commerce
expertise.

The first operating markets are Ghana and Nigeria. SnapDuka supports each
market's currency, phone and address conventions, Paystack payment channels,
and seller-managed delivery practices. The architecture must remain
country-configurable so Côte d'Ivoire, XOF, and French localization can be
introduced later without redesigning core commerce records.

SnapDuka is seller-led, not a centralized marketplace. Sellers own their
audience, storefront, product links, and customer relationships. Social
platforms are acquisition channels; SnapDuka is the reliable system of record
for products, payments, orders, fulfillment, and customer consent.

This document defines the complete product and divides delivery into three
releases:

1. **Foundation:** prove that sellers can publish, share, receive payment,
   fulfill orders, and create buyer trust.
2. **Growth:** help successful sellers retain customers, improve conversion,
   automate repeat work, and pay for advanced capabilities.
3. **Scale:** expand countries, teams, integrations, logistics, and optional
   buyer discovery.

## 2. Product Vision

### 2.1 Vision

Enable anyone selling through social media in West Africa to turn attention
into completed, trusted orders from a phone.

### 2.2 Seller Promise

A seller can create a professional shop, publish a first product, configure
payments and fulfillment, and share a working purchase link in minutes. Once
orders arrive, the seller sees what needs attention and can run the business
without reconstructing customer details from direct messages.

### 2.3 Buyer Promise

A buyer can move from a social post to a trustworthy product page, understand
the full cost and delivery options, pay or choose an approved offline method,
receive proof of the order, track progress, and request help without creating
an account.

### 2.4 Product Principles

1. **Mobile is the product.** Every core seller task must work on a low-end
   Android phone and remain comfortable for one-handed use.
2. **Value before configuration.** Onboarding should reach a shareable product
   quickly and defer nonessential setup.
3. **Trust must be visible.** Price, stock, payment state, seller verification,
   delivery terms, policies, receipts, and support paths must be explicit.
4. **Social platforms drive discovery.** SnapDuka must make links easy to
   publish and measure without depending on private or unstable social APIs.
5. **Weak connections are normal.** Drafts, retries, compressed media,
   idempotent operations, and clear recovery states are baseline behavior.
6. **Sellers keep control.** Sellers control products, pricing, fulfillment,
   enabled payment methods, and consent-based customer communication.
7. **Completed commerce beats vanity activity.** Product decisions optimize
   legitimate completed orders rather than raw page views or account creation.
8. **Complexity is earned.** Advanced automation, teams, integrations, and
   discovery arrive only after the core transaction loop is reliable.

## 3. Users and Problems

### 3.1 Primary Seller Persona

**Ama, the solo social seller**

- Sells fashion, beauty, food, electronics, home goods, or similar physical
  products through social posts and direct messages.
- Runs the business primarily from a phone.
- May have no formal website, point-of-sale system, or inventory software.
- Repeatedly answers questions about price, availability, delivery, and
  payment.
- Tracks orders across chats, notes, screenshots, and memory.
- Needs professional presentation and buyer trust but cannot spend hours
  configuring a traditional online store.
- Values more completed orders, fewer missed requests, faster follow-up, and
  clear payment evidence.

### 3.2 Primary Buyer Persona

**Kojo, the social buyer**

- Discovers products through a story, short video, status, or shared message.
- Uses a phone and expects the page to open immediately inside an in-app
  browser.
- Wants to confirm that the product, seller, price, payment, and delivery are
  legitimate.
- Does not want to create another account.
- Needs a receipt and a reliable way to track or question the order.

### 3.3 Internal Operations Persona

**SnapDuka support and risk operator**

- Reviews seller verification, storefront reports, payment events, disputes,
  and account risk.
- Needs a complete audit history and must not rely on direct database edits for
  normal operations.
- Applies documented restrictions and escalation rules consistently.

### 3.4 Problems to Solve

#### Seller Problems

- Social posts provide attention but do not provide structured checkout.
- Product facts become inconsistent across repeated direct-message replies.
- Orders are missed, duplicated, or fulfilled without clear payment status.
- Buyers abandon purchases when the process feels informal or untrustworthy.
- Sellers cannot easily tell which links, products, and promotions produce
  completed orders.
- Existing e-commerce tools are often too desktop-oriented, expensive, or
  operationally complex.

#### Buyer Problems

- Product price, stock, variants, delivery cost, and policies may be unclear.
- Payment requests in chat can be difficult to verify.
- Buyers lack a durable receipt or order-status view.
- It may be unclear how to request a cancellation, refund, or intervention.
- Slow pages and long forms make social traffic difficult to convert.

## 4. Goals and Non-Goals

### 4.1 Product Goals

- Let a new seller publish and share a first purchasable product from a phone.
- Convert traffic from social links into legitimate orders with minimal buyer
  friction.
- Give sellers one accurate view of payment, fulfillment, and required action.
- Support Paystack online payment and seller-approved offline payment methods.
- Improve buyer confidence through verification, transparent terms, receipts,
  tracking, and structured support.
- Help sellers understand and improve storefront conversion.
- Establish a free-to-paid product model tied to seller growth.
- Support 100 active sellers and 500 completed orders within the first 90 days
  of the Foundation release.

### 4.2 Non-Goals for the Foundation Release

- Native Android or iOS applications.
- A platform-operated delivery fleet.
- Escrow or SnapDuka manually holding and paying out seller funds.
- Required buyer accounts.
- A centralized marketplace feed as the primary acquisition model.
- Service bookings, digital downloads, subscriptions sold by sellers, tickets,
  or paid content.
- Deep catalog publishing or inbox access through private social APIs.
- Multi-country tax filing or accounting.
- Multi-user seller teams.

These non-goals may be revisited in later releases where explicitly stated.

## 5. Core User Journeys

### 5.1 Seller Activation

1. Seller creates an account and verifies a contact channel.
2. Seller selects Ghana or Nigeria; SnapDuka applies the relevant currency,
   phone, payment, and address configuration.
3. Seller enters shop name, unique slug, category, contact details, and a
   simple visual identity.
4. Seller adds a first product using the phone camera or gallery.
5. SnapDuka compresses images before upload and preserves the draft if upload
   fails.
6. Seller sets price, stock behavior, available variants, and product status.
7. Seller configures at least one fulfillment option and one payment option.
8. Seller previews the storefront and publishes it.
9. SnapDuka generates a shop link, product link, social-preview card, QR code,
   and suggested sharing actions.
10. The onboarding checklist remains available until payout and verification
    steps are complete.

### 5.2 Buyer Purchase

1. Buyer opens a shop, collection, or product link from a social platform.
2. Buyer sees current price, availability, variants, seller trust signals,
   delivery summary, and policies.
3. Buyer uses Buy Now or adds one or more items to the cart.
4. Buyer enters only the contact and fulfillment information required for the
   selected country and method.
5. Buyer sees a final cost breakdown before placing the order.
6. Buyer selects an enabled Paystack or offline payment method.
7. SnapDuka creates the order exactly once and reserves or decrements inventory
   according to the configured inventory policy.
8. Online payment is confirmed only after a valid Paystack webhook or explicit
   server-side verification.
9. Buyer receives a receipt and a secure order-status link.
10. Buyer may continue to WhatsApp for conversation without WhatsApp becoming
    the system of record.

### 5.3 Seller Fulfillment

1. A new order appears in the seller's commerce cockpit and notification
   channels.
2. The seller sees payment state, fulfillment method, buyer details, items,
   notes, and the next required action.
3. The seller confirms, prepares, dispatches, makes ready for pickup, fulfills,
   cancels, or records a refund as permitted by the current state.
4. Every transition produces an audit event and an appropriate transactional
   notification.
5. The order becomes completed only when fulfillment is complete and the
   payment obligation is satisfied or explicitly marked as an offline payment
   outcome.

### 5.4 Buyer Support and Dispute

1. Buyer opens the secure order link and selects an allowed support reason.
2. Buyer provides a description and optional evidence.
3. Seller receives a response deadline and can reply or propose a resolution.
4. Seller may cancel or initiate a Paystack refund when appropriate.
5. SnapDuka support can review the order, event history, messages, and evidence.
6. SnapDuka provides structured mediation and may warn, limit, suspend, or
   remove a seller under documented risk rules, but does not present the
   service as escrow or guaranteed buyer protection.

## 6. Functional Requirements

Priority labels:

- **P0:** required for the Foundation release.
- **P1:** required for the Growth release.
- **P2:** planned for the Scale release.

### 6.1 Accounts, Onboarding, and Verification

- **ACC-001 (P0):** A seller must be able to complete account creation and all
  Foundation setup tasks on mobile web.
- **ACC-002 (P0):** Authentication must support email and password. The
  identity boundary must permit phone-based authentication to be added later
  without changing seller ownership records.
- **ACC-003 (P0):** Seller records must store a country and derive default
  currency and validation rules from country configuration.
- **ACC-004 (P0):** A seller must be able to save and resume onboarding.
- **ACC-005 (P0):** The guided path must prioritize shop identity, first
  product, fulfillment, payment, preview, and publishing.
- **ACC-006 (P0):** Basic publishing may occur after contact verification and
  policy acceptance, but online payment acceptance requires the verification
  and settlement information required by Paystack and SnapDuka risk policy.
- **ACC-007 (P0):** Progressive verification must expose clear states:
  `not_started`, `in_progress`, `needs_action`, `verified`, `rejected`, and
  `suspended`.
- **ACC-008 (P0):** Verified status must be displayed only when the applicable
  verification checks remain valid.
- **ACC-009 (P0):** SnapDuka must create and associate a Paystack subaccount
  with each eligible verified seller.
- **ACC-010 (P1):** Paid plans may unlock custom branding and operational
  limits but must not sell or imply verification.

### 6.2 Storefront and Shop Identity

- **SHP-001 (P0):** Every published seller must have a unique, stable,
  human-readable storefront slug.
- **SHP-002 (P0):** The public storefront must display shop name, logo or
  fallback identity, description, location or service area, supported contact
  channels, verification state, fulfillment summary, and policy links.
- **SHP-003 (P0):** Sellers must be able to preview unpublished changes before
  making them public.
- **SHP-004 (P0):** Unpublished, suspended, or unknown shops must render a
  clear state without leaking private seller information.
- **SHP-005 (P0):** Storefronts must support product search, category or
  collection browsing, stock state, and price display.
- **SHP-006 (P0):** Storefront metadata must produce useful social-preview
  cards for shop, collection, and product links.
- **SHP-007 (P1):** Sellers must be able to select from constrained,
  performance-safe themes and branding controls.
- **SHP-008 (P1):** Eligible paid plans must support custom domains with
  verification, HTTPS, and a recoverable fallback SnapDuka URL.
- **SHP-009 (P2):** Sellers may opt into centralized buyer discovery without
  changing ownership of their storefront or customer records.

### 6.3 Catalog, Variants, and Inventory

- **CAT-001 (P0):** Sellers must be able to create, edit, duplicate, archive,
  hide, publish, and mark products sold out.
- **CAT-002 (P0):** A product must support name, description, media, category,
  collection membership, currency, base price, optional compare-at price,
  status, and fulfillment notes.
- **CAT-003 (P0):** Products must support variants such as size and color, with
  variant-specific price, SKU, image, and stock quantity where needed.
- **CAT-004 (P0):** Sellers must choose whether a product tracks finite stock,
  allows preorder, or is treated as always available.
- **CAT-005 (P0):** The system must prevent the same finite stock from being
  sold beyond the configured quantity under concurrent checkout.
- **CAT-006 (P0):** Cart and order line items must store immutable snapshots of
  product name, variant, unit price, currency, and relevant media.
- **CAT-007 (P0):** Product deletion must never erase historical order facts.
- **CAT-008 (P0):** Images must be resized and compressed before upload, with a
  maximum dimension and output format chosen to balance readability and data
  usage.
- **CAT-009 (P0):** Upload failure must preserve the product draft and allow an
  individual image to be retried or removed.
- **CAT-010 (P1):** Sellers must be able to perform bulk stock, price, status,
  and collection updates.
- **CAT-011 (P1):** Buyers may request consent-based restock notification for
  an unavailable product.

### 6.4 Social Sharing and Attribution

- **SOC-001 (P0):** Sellers must be able to copy and share links to a shop,
  collection, product, cart, or promotion.
- **SOC-002 (P0):** Share actions must include WhatsApp and the device share
  sheet where supported, without requiring direct social-platform API access.
- **SOC-003 (P0):** SnapDuka must generate downloadable QR codes for shops and
  products.
- **SOC-004 (P0):** Shared links must retain seller and product context through
  checkout.
- **SOC-005 (P1):** Sellers must be able to create named campaign links for
  Snapchat, TikTok, Instagram, WhatsApp, and custom sources.
- **SOC-006 (P1):** Analytics must attribute sessions, initiated checkouts,
  orders, and completed orders to campaign links when possible.
- **SOC-007 (P1):** SnapDuka may generate suggested captions and story-card
  assets, but sellers remain responsible for publishing them.
- **SOC-008 (P2):** Deep social integrations may be introduced only where
  stable APIs, user consent, and platform policies support them.

### 6.5 Cart and Guest Checkout

- **CHK-001 (P0):** Buyers must be able to use Buy Now or a multi-product cart
  without creating an account.
- **CHK-002 (P0):** A cart may contain products from only one seller.
- **CHK-003 (P0):** Checkout must collect the minimum contact, address, and
  delivery information required by the seller's country and fulfillment
  method.
- **CHK-004 (P0):** Buyer phone numbers must be normalized and validated using
  country-specific rules.
- **CHK-005 (P0):** The final review must show item subtotal, discounts,
  delivery fee, payment-related charges where legally and contractually
  permitted, and total currency amount.
- **CHK-006 (P0):** Price, stock, discount, and delivery eligibility must be
  recalculated on the server before order creation.
- **CHK-007 (P0):** Repeated submission, refresh, or network retry must not
  create duplicate orders.
- **CHK-008 (P0):** Invalid or unavailable items must be identified
  individually while preserving the rest of the cart where possible.
- **CHK-009 (P0):** Form errors must be shown beside the relevant field and
  must not erase valid buyer input.
- **CHK-010 (P1):** With buyer consent, SnapDuka may send a limited abandoned
  checkout reminder with a direct resume link.

### 6.6 Payments, Settlements, and Refunds

- **PAY-001 (P0):** Sellers must be able to enable the Paystack channels
  available to their market and account.
- **PAY-002 (P0):** SnapDuka must use Paystack subaccounts to route settlement
  to eligible sellers and to support a configured platform fee.
- **PAY-003 (P0):** SnapDuka must not mark an order paid solely because a buyer
  returns to a success URL.
- **PAY-004 (P0):** Payment confirmation must use a signed Paystack webhook or
  server-to-server transaction verification.
- **PAY-005 (P0):** Webhook processing must verify signatures, be idempotent,
  record the provider event, and tolerate duplicate, delayed, and out-of-order
  delivery.
- **PAY-006 (P0):** Payment state must be independent of fulfillment state and
  support `unpaid`, `pending`, `paid`, `failed`, `partially_refunded`,
  `refunded`, and `offline_due`.
- **PAY-007 (P0):** Sellers may enable approved offline methods including cash
  on delivery, pay on pickup, or seller-arranged payment.
- **PAY-008 (P0):** Offline payment instructions must be explicit, and sellers
  must record the outcome without representing it as Paystack-confirmed.
- **PAY-009 (P0):** Every payment attempt must use a unique provider reference
  linked to a stable internal order.
- **PAY-010 (P0):** Authorized operators and eligible sellers must be able to
  initiate full or partial refunds according to order state and policy.
- **PAY-011 (P0):** Refund state and provider reference must be visible to the
  seller, buyer, and support operator at the appropriate level of detail.
- **PAY-012 (P0):** Payment credentials and webhook secrets must never be
  exposed to client code.
- **PAY-013 (P1):** Sellers must be able to reconcile orders against settlement
  summaries and export the underlying records.

Paystack implementation must follow its current official
[payment-channel documentation](https://paystack.com/docs/payments/payment-channels/)
and [Subaccount API](https://paystack.com/docs/api/subaccount/). Provider
capabilities must be treated as configuration because channel and country
availability can change.

### 6.7 Fulfillment, Delivery, and Pickup

- **FUL-001 (P0):** Sellers must be able to create delivery zones with names,
  fees, estimated windows, and buyer instructions.
- **FUL-002 (P0):** Sellers must be able to offer one or more pickup locations
  with instructions and availability notes.
- **FUL-003 (P0):** The buyer must select only a fulfillment option valid for
  the current cart and address or area.
- **FUL-004 (P0):** Fulfillment state must support `unconfirmed`, `confirmed`,
  `preparing`, `ready_for_pickup`, `dispatched`, `fulfilled`, `cancelled`, and
  `returned`.
- **FUL-005 (P0):** State transitions must be constrained so impossible
  transitions cannot be produced accidentally.
- **FUL-006 (P0):** Sellers must be able to record a courier name, tracking
  reference, delivery note, and expected date without requiring a courier
  integration.
- **FUL-007 (P0):** Buyer-facing status must use simple language and must not
  expose internal risk or support notes.
- **FUL-008 (P2):** Courier integrations may provide quotes, booking, labels,
  and tracking while preserving seller-managed fallback options.

### 6.8 Orders and Seller Commerce Cockpit

- **ORD-001 (P0):** The seller home screen must prioritize new orders,
  payment or fulfillment exceptions, and the next required actions.
- **ORD-002 (P0):** The same screen must summarize today's completed order
  value, completed order count, storefront visits, and conversion when data is
  available.
- **ORD-003 (P0):** Sellers must be able to filter and search orders by state,
  payment, fulfillment, date, buyer, order number, and product.
- **ORD-004 (P0):** The order detail must show items, immutable prices,
  customer details, fulfillment details, payment evidence, event history,
  notes, and available actions.
- **ORD-005 (P0):** Order identity must use a non-sequential public reference
  that does not reveal platform volume.
- **ORD-006 (P0):** Every material order mutation must record actor, timestamp,
  previous state, new state, and source.
- **ORD-007 (P0):** Seller notes must be private; buyer-visible updates must be
  intentionally marked or generated by a status transition.
- **ORD-008 (P1):** Sellers must be able to export filtered orders and perform
  constrained bulk status actions.

### 6.9 Receipts, Tracking, and Notifications

- **NOT-001 (P0):** Buyers must receive an on-screen receipt immediately after
  a successfully created order.
- **NOT-002 (P0):** Each order must have a secure status URL that does not
  require a buyer account and cannot be guessed from a sequential identifier.
- **NOT-003 (P0):** Sensitive order access must use the secure token and may
  require contact verification for higher-risk actions or expired links.
- **NOT-004 (P0):** Transactional notifications must cover order creation,
  payment confirmation or failure, seller confirmation, dispatch or pickup
  readiness, fulfillment, cancellation, refund, and dispute updates.
- **NOT-005 (P0):** In-app notifications are required for sellers. Email is
  required when an email is available.
- **NOT-006 (P0):** WhatsApp transactional messaging may be used only with
  appropriate consent, approved templates where required, provider support,
  and cost controls.
- **NOT-007 (P0):** Buyer-initiated WhatsApp handoff must remain available when
  the seller provides a valid WhatsApp number.
- **NOT-008 (P0):** Notification failure must not roll back a valid order or
  payment event; failures must be retried and visible to operations.
- **NOT-009 (P1):** Web push may supplement but must not be the only channel
  for critical events.
- **NOT-010 (P1):** Sellers must be able to configure noncritical notification
  preferences without disabling required security or payment notices.

### 6.10 Customers, Consent, and Retention

- **CUS-001 (P0):** SnapDuka must maintain a seller-scoped customer record from
  completed or legitimate orders without creating a global buyer profile.
- **CUS-002 (P0):** Transactional communication authority must be stored
  separately from marketing consent.
- **CUS-003 (P0):** Consent records must include channel, purpose, source,
  timestamp, policy version, and withdrawal state.
- **CUS-004 (P0):** A buyer must be able to withdraw marketing consent without
  losing access to receipts or necessary transactional updates.
- **CUS-005 (P1):** Sellers must be able to view order history, total completed
  orders, completed value, last order date, and consent status for their own
  customers.
- **CUS-006 (P1):** Sellers must be able to create simple, consent-aware
  segments such as first-time, repeat, recently active, or product interest.
- **CUS-007 (P1):** Broadcasts and automated reminders must enforce consent,
  frequency limits, unsubscribe behavior, and plan entitlements.
- **CUS-008 (P1):** Restock and abandoned-checkout messages must be scoped to
  the specific buyer request or consent.

### 6.11 Promotions and Analytics

- **GRO-001 (P0):** The Foundation release must report storefront visits,
  product views, checkout starts, orders, completed orders, payment success,
  and fulfillment completion.
- **GRO-002 (P0):** Sellers must see metric definitions and the selected date
  range.
- **GRO-003 (P0):** Analytics must exclude known test activity and make
  reasonable efforts to reduce obvious bot traffic.
- **GRO-004 (P1):** Sellers must be able to create fixed-value or percentage
  discount codes with validity dates, usage limits, minimum totals, and
  product or collection scope.
- **GRO-005 (P1):** Promotions must be validated on the server and snapshotted
  on the order.
- **GRO-006 (P1):** Sellers must see conversion funnels, top products,
  campaign attribution, repeat-buyer rate, average order value, cancellation,
  refund, and fulfillment performance.
- **GRO-007 (P1):** Analytics must not expose one seller's data to another or
  use buyer data beyond documented purposes.

### 6.12 Plans, Entitlements, and Billing

- **BIL-001 (P0):** Every seller must be assigned a plan and a versioned set of
  entitlements.
- **BIL-002 (P0):** The free plan must support a useful end-to-end commerce
  loop: publish products, share a shop, receive orders, accept an available
  payment method, and fulfill orders.
- **BIL-003 (P1):** Paid plans may increase catalog, automation, analytics,
  export, branding, domain, and future team limits.
- **BIL-004 (P1):** Final prices and limits must be configurable and are not
  defined by this PRD.
- **BIL-005 (P1):** Paystack processing charges, SnapDuka subscription charges,
  and any SnapDuka transaction fee must be displayed as separate concepts.
- **BIL-006 (P1):** Downgrade must preserve seller data and explain which
  capabilities become read-only or unavailable.
- **BIL-007 (P1):** Billing failure must use a grace period and clear recovery
  path before restricting paid capabilities.

### 6.13 Disputes, Risk, and Administration

- **OPS-001 (P0):** Buyers must be able to report an order or seller through a
  structured reason, description, and optional evidence.
- **OPS-002 (P0):** Sellers must be notified of a case and given a response
  path and deadline where appropriate.
- **OPS-003 (P0):** Support operators must be able to review seller, order,
  payment, refund, fulfillment, message, evidence, and audit context.
- **OPS-004 (P0):** Operators must be able to record decisions, internal
  notes, buyer-visible outcomes, and follow-up actions.
- **OPS-005 (P0):** Risk controls must support warnings, verification
  requirements, payment restrictions, temporary suspension, and permanent
  removal.
- **OPS-006 (P0):** Destructive or high-risk administrative actions must
  require explicit confirmation and produce an immutable audit event.
- **OPS-007 (P0):** Normal seller onboarding and support operations must not
  require direct database editing.
- **OPS-008 (P0):** SnapDuka must publish seller, buyer, prohibited-product,
  privacy, refund, dispute, and acceptable-use policies before public launch.
- **OPS-009 (P1):** Risk views should identify unusual refund, dispute,
  payment-failure, account, and order patterns without automatically treating
  them as proof of wrongdoing.

## 7. State and Data Requirements

### 7.1 Independent State Models

An order must not use one overloaded status. At minimum it contains:

- **Order state:** `draft`, `placed`, `confirmed`, `completed`, `cancelled`.
- **Payment state:** defined in PAY-006.
- **Fulfillment state:** defined in FUL-004.
- **Refund state:** `none`, `requested`, `processing`, `partial`, `completed`,
  `failed`.
- **Dispute state:** `none`, `opened`, `seller_response_due`, `under_review`,
  `resolved`, `closed`.

The implementation may add internal substates, but public and internal state
transitions must be documented and deterministic.

### 7.2 Core Records

The platform requires distinct records for:

- Seller account, shop, verification, payout/subaccount, policy acceptance,
  plan, and entitlements.
- Product, variant, media, collection, inventory movement, and stock
  reservation.
- Cart, checkout attempt, order, order line snapshot, payment attempt,
  provider event, settlement reference, and refund.
- Fulfillment option, delivery zone, pickup location, shipment details, and
  fulfillment event.
- Seller-scoped customer, address snapshot, consent, campaign attribution, and
  notification preference.
- Notification request, attempt, provider response, and delivery state.
- Support case, dispute evidence, risk action, operator note, and audit event.
- Analytics event with a documented retention and privacy policy.

### 7.3 Country Configuration

Country behavior must be data-driven and include:

- ISO country and currency codes.
- Phone normalization and display rules.
- Address fields and labels.
- Available Paystack channels and offline methods.
- Delivery terminology and default units.
- Locale, time zone, date, number, and currency formatting.
- Policy or verification differences.

No Ghana- or Nigeria-specific rule may be silently applied to the other market.

## 8. Mobile, PWA, and Experience Requirements

### 8.1 Navigation and Interaction

- Seller navigation must use a commerce cockpit with direct access to Home,
  Orders, Products, Growth, and Shop.
- The most important action on each screen must be reachable without precise
  tapping or horizontal scrolling.
- Interactive targets must be at least 44 by 44 CSS pixels.
- Forms must use appropriate mobile keyboard types, autocomplete attributes,
  clear labels, inline validation, and visible progress.
- Destructive actions must be separated from routine actions and require
  confirmation.
- Bottom sheets may be used for short contextual tasks; long or critical flows
  must use full pages with recoverable navigation.

### 8.2 Performance Budgets

Measured on a representative low-end Android device and throttled mobile
connection:

- A cached or server-rendered storefront should display primary product and
  shop content within 3 seconds on a good 3G profile at the 75th percentile.
- Initial JavaScript for a public product page should target no more than
  200 KB compressed, excluding images and third-party payment UI.
- The primary storefront image should target 150 KB or less where visual
  quality permits; responsive sizes and lazy loading are required.
- Seller routes must load incrementally and must not download analytics or
  catalog data unrelated to the current task.
- Payment and order completion must remain correct even when the browser loses
  connectivity after submission.

Performance budgets may be adjusted only with measured evidence and a recorded
product decision.

### 8.3 Offline and Recovery Behavior

- Product and shop forms must preserve drafts locally and reconcile them after
  connectivity returns.
- Retrying a mutation must use an idempotency key where duplicates would be
  harmful.
- The UI must distinguish offline, timed out, rejected, and server-failed
  states.
- A payment in an unknown state must be shown as pending and reconciled; the
  buyer must not be asked to pay again until the previous attempt is resolved
  or safely expired.
- The PWA shell may be installable and cache non-sensitive static assets, but
  private order or customer data must not be broadly persisted in shared
  browser caches.

### 8.4 Accessibility

- Core buyer and seller journeys must meet WCAG 2.2 AA intent.
- All actions must work with keyboard and assistive technology.
- Color must not be the only representation of stock, payment, fulfillment, or
  error state.
- Text must remain usable at 200% zoom and with device font scaling.
- Images require useful alternative text or an explicit decorative role.
- Motion must respect reduced-motion preferences.

## 9. Security, Privacy, and Reliability

- Postgres Row-Level Security remains the primary tenant-isolation control.
- A seller must never read or mutate another seller's private products,
  orders, customers, payments, analytics, or files.
- Public database access must expose only fields intentionally required for a
  published storefront.
- Privileged credentials must remain server-only and secrets must be stored in
  managed environment configuration.
- Public mutations require validation, abuse controls, rate limits, and
  bot-resistant techniques proportionate to risk.
- Sensitive records must be encrypted in transit and at rest using platform
  capabilities.
- Logs and analytics must avoid unnecessary buyer PII and payment details.
- Buyer phone, email, address, and dispute evidence require documented
  retention and deletion rules before public launch.
- Account recovery, payout changes, refund actions, and high-risk operator
  actions require step-up verification where supported.
- Payment webhooks must verify provider signatures before changing financial
  state.
- External event processing must use durable retries, idempotency, and a
  recoverable failure queue.
- Database migrations must be version-controlled; production schema must not
  be maintained through undocumented manual edits.
- Backups and restoration procedures must be tested before public launch.

## 10. Metrics and Instrumentation

### 10.1 North-Star Metric

**Completed orders:** unique legitimate orders for which the fulfillment
obligation is complete and the payment obligation is paid, refunded under an
accepted resolution, or correctly recorded as completed through an approved
offline method.

Test orders, known fraud, duplicates, and cancelled orders do not count.

### 10.2 Launch Success

Within 90 days of the Foundation public release:

- At least 100 sellers are active.
- At least 500 orders meet the completed-order definition.

An active seller has a published shop and has logged in or received a
legitimate order within the trailing 30 days.

### 10.3 Supporting Metrics

- Signup-to-published-shop activation rate.
- Median time from signup to first published product.
- Percentage of published sellers who share a tracked link.
- Storefront visit to checkout-start conversion.
- Checkout-start to placed-order conversion.
- Online payment success and pending-payment resolution rates.
- Order confirmation and fulfillment completion rates.
- Median time to seller confirmation and completion.
- Repeat-buyer rate.
- Cancellation, refund, return, dispute, and seller-report rates.
- Seller retention at 30 and 90 days.
- Transactional notification delivery rate by channel.
- Support case volume and resolution time.
- P75 storefront performance on target mobile conditions.

Metrics must be segmented by country, acquisition source, payment method, and
seller cohort where privacy and sample size allow.

## 11. Release Plan

### 11.1 Foundation Release

The Foundation release includes all P0 requirements and must deliver:

- Mobile self-service seller onboarding and progressive verification.
- Country-aware Ghana and Nigeria configuration.
- Public storefronts, products, variants, stock, collections, search, and
  social sharing.
- Buy Now, single-seller cart, guest checkout, and transparent totals.
- Paystack subaccounts, market-available online channels, offline methods,
  webhooks, receipts, and refunds.
- Seller-managed delivery zones and pickup.
- Commerce cockpit, order detail, independent payment and fulfillment states,
  and auditable transitions.
- In-app and email notifications, consent-based WhatsApp support, and
  buyer-initiated WhatsApp handoff.
- Secure buyer tracking, basic customer consent records, basic analytics,
  disputes, risk controls, and operational administration.
- A versioned free-plan entitlement model, even though paid-plan billing is
  deferred.

### 11.2 Growth Release

The Growth release includes P1 requirements:

- Paid subscriptions and configurable entitlements.
- Custom domains and expanded branding.
- Campaign links, deeper conversion analytics, and data exports.
- Coupons and promotion controls.
- Customer directory, consent-aware segments, broadcasts, restock messages,
  and abandoned-checkout recovery.
- Bulk catalog and order actions.
- Settlement reconciliation and stronger support and risk workflows.
- Web push as a supplementary channel.

### 11.3 Scale Release

The Scale release includes P2 requirements:

- French localization and Côte d'Ivoire configuration, including XOF and
  supported payment channels.
- Courier quotes, booking, and tracking integrations.
- Seller team roles and permissions.
- Public APIs, outbound webhooks, and accounting or operational integrations.
- Advanced automation.
- Optional buyer discovery and marketplace-style browsing.

Each Scale feature requires a separate approved product specification before
implementation.

## 12. Acceptance and Validation

### 12.1 End-to-End Acceptance Scenarios

The Foundation release is not ready until automated or documented acceptance
tests demonstrate:

1. A Ghanaian seller signs up on mobile, publishes a variant product, enables
   mobile money or another available Paystack method, configures delivery, and
   shares the product.
2. A Nigerian seller completes the equivalent flow using NGN and an available
   Nigerian Paystack channel.
3. A guest buyer purchases multiple products from one seller, sees the final
   total, pays online, receives a receipt, and tracks fulfillment.
4. A guest buyer places a cash-on-delivery or pay-on-pickup order and sees that
   payment is due rather than Paystack-confirmed.
5. A seller confirms, prepares, dispatches or marks ready for pickup, and
   completes the order while the buyer receives appropriate updates.
6. An authorized refund updates provider, payment, refund, order, audit, and
   buyer-facing records consistently.
7. A buyer opens a dispute, the seller responds, and an operator records a
   resolution with evidence and audit history.

### 12.2 Failure and Edge Scenarios

Tests must cover:

- Duplicate checkout submissions and browser refresh.
- Duplicate, delayed, invalidly signed, and out-of-order Paystack webhooks.
- A successful provider payment followed by loss of browser connectivity.
- Failed, abandoned, pending, refunded, and partially refunded payments.
- Image upload interruption and draft recovery.
- Offline seller edits and conflicting updates.
- Two buyers attempting to purchase the last finite-stock item.
- Product price or availability changing during checkout.
- Invalid campaign, promotion, order-tracking, and custom-domain links.
- Notification provider outage without loss of order state.
- Seller suspension while public links or active orders exist.
- Consent withdrawal after a marketing workflow has been scheduled.
- Unauthorized access attempts across seller boundaries.

### 12.3 Quality Gates

- Unit coverage for validation, country configuration, price calculation,
  inventory, transitions, consent, entitlement, and provider-event logic.
- Integration coverage for checkout, order creation, Paystack initialization
  and webhooks, refunds, notifications, and RLS policies.
- End-to-end coverage for the seven primary acceptance scenarios.
- Accessibility testing using automated checks and manual keyboard and screen
  reader review of critical flows.
- Performance testing against the budgets in Section 8.
- Security review of authentication, RLS, payment signatures, public order
  tokens, uploads, rate limits, administrative actions, and secrets.
- Restoration test for database backup and critical storage metadata.

## 13. Dependencies and Risks

### 13.1 Dependencies

- Paystack account approval, subaccounts, country-specific channels, webhooks,
  refunds, and settlement behavior.
- Supabase Postgres, Auth, Storage, and Row-Level Security.
- Vercel hosting and server execution limits.
- Transactional email and approved WhatsApp provider/template availability.
- Published legal and operational policies.
- Human support capacity for verification, disputes, and risk review.

### 13.2 Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Sellers abandon setup | Save progress, prioritize first product, use a visible checklist, and defer optional fields. |
| Buyers distrust social sellers | Show verification, full totals, payment evidence, receipts, policies, tracking, and support access. |
| Paystack capability differs by country | Drive channels from country and provider configuration; verify server-side before display and payment creation. |
| Duplicate or delayed provider events corrupt state | Store provider events, verify signatures, enforce idempotency, and reconcile pending payments. |
| Sellers oversell limited inventory | Use transactional reservations or guarded stock updates and release expired reservations. |
| WhatsApp cost or policy limits delivery | Treat WhatsApp as one consent-based channel; preserve in-app, email, tracking links, and buyer-initiated handoff. |
| Support load grows faster than revenue | Use structured cases, clear policies, self-service tracking, risk limits, and phased seller growth. |
| Buyer PII creates privacy exposure | Minimize collection, isolate tenants, redact logs, document retention, and restrict operator access. |
| Feature breadth weakens mobile simplicity | Keep Foundation focused, gate advanced capabilities by release and plan, and preserve the action-oriented commerce cockpit. |

## 14. Reconciliation with the 2026-06-10 MVP Design

This PRD is the authoritative product document. The earlier
`docs/superpowers/specs/2026-06-10-snapduka-mvp-design.md` remains useful for
technical foundations where this PRD does not conflict.

### 14.1 Decisions Preserved

- Next.js App Router, strict TypeScript, Tailwind CSS, Supabase, and Vercel.
- RLS-first tenant authorization.
- Public, server-rendered storefronts optimized for mobile networks.
- Immutable product name and price snapshots on order lines.
- Database constraints, version-controlled migrations, image compression, and
  explicit loading, success, and error states.
- Seller-managed fulfillment and WhatsApp handoff.

### 14.2 Decisions Superseded

| Earlier MVP decision | Authoritative requirement |
|---|---|
| Ghana-only | Foundation supports Ghana and Nigeria through country configuration. |
| Hand-onboarded cohort | Sellers use mobile self-service onboarding with progressive verification. |
| No admin UI | Foundation includes operational administration for verification, reports, disputes, and risk actions. |
| No payments | Foundation integrates Paystack subaccounts plus approved offline payment methods. |
| Buyer-driven WhatsApp is the only new-order notification | In-app and email are required; consent-based WhatsApp may supplement them, and buyer handoff remains available. |
| One product per order | Foundation supports Buy Now and a single-seller, multi-product cart. |
| Basic products without variants or inventory | Foundation supports variants, stock policies, reservations, collections, and preorder/sold-out behavior. |
| Ghana-only phone normalization | Validation is country-configured for Ghana and Nigeria. |
| Plain buyer PII accepted without a broader lifecycle | Public launch requires documented minimization, access, retention, and deletion controls. |
| Analytics, CRM, and subscriptions out of scope | Basic analytics and consent records are Foundation requirements; CRM and paid subscriptions enter Growth. |
| No staging environment implied by trunk-based MVP | The delivery process must provide a safe pre-production environment for payment, migration, RLS, and end-to-end validation. |

### 14.3 Deferred from the Complete Vision

The following remain outside Foundation but are intentionally represented in
the product model: paid subscriptions, advanced retention workflows, French
and Côte d'Ivoire, courier integrations, seller teams, public APIs, advanced
automation, and optional buyer discovery.

## 15. Open Product Decisions

No unresolved decision blocks Foundation planning. The following values must be
set through subsequent pricing, policy, or implementation specifications
before their related capability launches:

- Free and paid plan prices and numeric entitlement limits.
- SnapDuka platform-fee percentage, if any.
- Verification evidence and review thresholds by country.
- Published cancellation, return, refund, dispute, prohibited-product,
  retention, and enforcement policies.
- Notification provider selection and WhatsApp template portfolio.
- Exact inventory-reservation expiry duration.
- Target service-level objectives and support response times.

These are intentionally configuration or policy decisions, not permission to
change the product principles, release boundaries, or acceptance criteria in
this PRD.
