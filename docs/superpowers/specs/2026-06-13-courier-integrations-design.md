# SnapDuka Courier Integrations Design

## Scope

Add optional courier quotes, booking, labels, and tracking while preserving
seller-managed delivery and pickup fallbacks.

## Architecture

A provider-neutral courier adapter exposes quote, book, cancel, label, and
track operations. The initial built-in provider is `manual`, which models the
complete lifecycle without an external credential. Additional HTTP providers
use encrypted server-side credentials and the same contract.

## Data Model

- `courier_connections`
- `courier_quotes` with expiry and immutable request/price snapshots
- `shipments` with provider and internal states
- `shipment_events`
- `shipment_labels`

Shipment state is independent of order and payment state. Provider events are
signed where supported, idempotent, and mapped to internal states.

## Behavior

Sellers may request quotes for an order, choose one, book it, download a label,
and view tracking. Buyers see only safe tracking events. A seller can always
switch to manual courier name/reference/date fields when provider booking is
unavailable.

Courier costs are shown separately and cannot silently alter an already placed
order total. Pre-checkout live quotes require explicit country configuration;
otherwise the seller's configured fulfillment fee remains authoritative.

## Failure Handling

Expired quotes cannot book. Provider timeouts produce retryable errors without
changing fulfillment state. Duplicate callbacks do not duplicate shipments.
Cancellation failure leaves the shipment marked for operator review.

## Acceptance

Contract tests cover adapter behavior. Integration tests cover quote expiry,
booking idempotency, label access, tracking event ordering, provider outage,
manual fallback, seller isolation, and buyer-safe tracking.
