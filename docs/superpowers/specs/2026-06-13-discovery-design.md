# SnapDuka Buyer Discovery Design

## Scope

Add optional marketplace-style browsing without changing SnapDuka into a
centralized merchant of record or transferring customer ownership.

## Architecture

Discovery is a read-optimized projection of explicitly opted-in shops,
collections, and active products. Storefront, checkout, payment, fulfillment,
support, and customer records continue to belong to the seller. Discovery links
carry source attribution into the existing seller checkout.

## Behavior

Eligible sellers opt in and select discoverable collections/products. Buyers
can browse by country, category, price range, availability, and text search.
Ranking uses deterministic quality, recency, availability, and engagement
signals with no paid placement in this release.

Discovery cards display seller identity, country, price, availability, and
trust signals. They route to the seller's storefront or product page. A cart
remains single-seller; crossing sellers starts a separate cart.

Operators can remove prohibited or unsafe listings without deleting the
seller's private catalog. Sellers can opt out immediately. Discovery indexing
stores no buyer contact data.

## Failure Handling

Suspended sellers, unpublished shops, inactive products, and out-of-stock
finite inventory are excluded. Stale index entries are filtered again at read
time. Invalid filters return empty results or validation errors without leaking
private inventory.

## Acceptance

Tests cover explicit opt-in, immediate opt-out, country/category/search filters,
ranking determinism, seller suspension, stale-index filtering, single-seller
cart behavior, attribution, operator removal, and absence of buyer PII.
