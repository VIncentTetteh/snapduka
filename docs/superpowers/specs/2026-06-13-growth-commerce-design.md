# SnapDuka Growth Commerce Design

## Scope

This specification implements all P1 requirements for plans, subscriptions,
branding, promotions, campaigns, customer retention, exports, notifications,
analytics, bulk operations, reconciliation, and risk insights.

## Architecture

Growth capabilities share a versioned entitlement service. Every protected
operation resolves the seller's current entitlement snapshot server-side.
Limits and prices live in database configuration, never in UI constants.
Downgrades preserve records and switch excess capabilities to read-only.

Paystack subscription billing uses dedicated subscription records and webhook
events, separate from buyer order payments. Billing states are `trialing`,
`active`, `past_due`, `grace`, `cancelled`, and `expired`. A configurable grace
period delays restrictions after failure.

## Data Model

- `plan_prices`, `seller_subscriptions`, `subscription_events`
- `shop_branding`, `custom_domains`
- `promotions`, `promotion_redemptions`, order promotion snapshots
- `campaign_links`, analytics campaign attribution
- `customer_segments`, `segment_memberships`
- `marketing_campaigns`, `marketing_deliveries`
- `restock_requests`, `abandoned_checkouts`
- `notification_preferences`, `push_subscriptions`
- `settlement_imports`, `settlement_lines`
- `export_jobs`, `risk_signals`

All seller-owned records include `seller_account_id`, forced RLS, operator
visibility where operationally required, and immutable audit events for
material mutations.

## Behavior

Sellers can choose constrained themes, colors, logos, and typography tokens.
Custom domains require a DNS challenge and retain the SnapDuka fallback URL.

Promotions support fixed or percentage discounts, validity windows, minimum
totals, usage limits, and product or collection scope. Checkout validates them
atomically and snapshots discount facts on orders.

Campaign links carry a stable campaign token through visit, checkout, order,
and completion. Captions and story cards are generated locally from seller and
product data without publishing to social platforms.

Customer views aggregate completed-order value, count, last order, and consent.
Segments are rule-based and consent-aware. Broadcasts, abandoned checkout, and
restock workflows enforce channel consent, frequency caps, unsubscribe state,
plan entitlement, and specific request scope.

Exports use asynchronous jobs and signed short-lived downloads. Bulk product
and order actions validate each item independently and return per-item results.
Settlement reconciliation matches Paystack references to payments and reports
missing, duplicated, or amount-mismatched lines.

Risk insights surface unusual rates and thresholds as review signals only.
They never automatically prove wrongdoing or suspend sellers.

## Failure Handling

Webhook and automation inputs are idempotent. Billing failures enter grace
before restrictions. Invalid promotions return buyer-safe errors without
destroying carts. Marketing provider failure records attempts and never rolls
back commerce state. Domain verification failure leaves the fallback URL live.

## Acceptance

Tests must prove entitlement enforcement, downgrade preservation, billing grace,
promotion concurrency, campaign attribution, consent withdrawal after queueing,
frequency limits, export isolation, reconciliation mismatches, custom-domain
fallback, and seller-isolated analytics and risk signals.
