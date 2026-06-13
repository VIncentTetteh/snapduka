# Foundation P0 Traceability

Each P0 requirement is mapped to its primary implementation and verification surface. Category-level automated suites cover multiple rows.

| Requirement | Implementation | Verification |
| --- | --- | --- |
| ACC-001 | `src/app/(seller)/onboarding` | onboarding unit and database tests |
| ACC-002 | `src/app/(auth)/login` | auth action/page tests |
| ACC-003 | country-aware core schema | `001_core.test.sql` |
| ACC-004 | onboarding persisted milestones | onboarding tests |
| ACC-005 | onboarding milestone engine | `onboarding.test.ts` |
| ACC-006 | shop/product draft and publish states | catalog and RLS tests |
| ACC-007 | `seller_verifications` | onboarding database tests |
| ACC-008 | verification-gated payment setup | onboarding tests |
| ACC-009 | Paystack subaccount workflow | subaccount tests |
| SHP-001 | `shops.slug` and storefront routes | storefront tests |
| SHP-002 | shop header and trust summary | mobile acceptance |
| SHP-003 | draft product/shop states | catalog tests |
| SHP-004 | public RLS and not-found UI | catalog RLS tests |
| SHP-005 | storefront search and collections query | storefront build/acceptance |
| SHP-006 | metadata and Open Graph image | production build |
| CAT-001 | seller product actions | catalog tests |
| CAT-002 | products and media schema | catalog database tests |
| CAT-003 | product variants | catalog database tests |
| CAT-004 | inventory policies | inventory tests |
| CAT-005 | row-locked reservation RPC | catalog database contention test |
| CAT-006 | immutable `order_lines` snapshots | order database tests |
| CAT-007 | restrictive product references | order migration |
| CAT-008 | image compression helpers | image tests |
| CAT-009 | preserved server-action values | product form behavior |
| SOC-001 | canonical shop/product links | sharing tests |
| SOC-002 | device share and WhatsApp | sharing tests |
| SOC-003 | downloadable QR images | storefront build/acceptance |
| SOC-004 | stable seller/product routes | sharing tests |
| CHK-001 | Buy Now and cart provider | checkout build |
| CHK-002 | seller-scoped checkout route | order RPC |
| CHK-003 | guest checkout form | mobile acceptance |
| CHK-004 | country phone normalization | order tests |
| CHK-005 | quote and checkout totals | quote tests |
| CHK-006 | server-side price and stock validation | order RPC |
| CHK-007 | idempotency keys | order database tests |
| CHK-008 | typed unavailable-product errors | checkout API |
| CHK-009 | preserved form state and live errors | checkout form |
| PAY-001 | Paystack initialization | Paystack tests |
| PAY-002 | seller subaccount initialization | Paystack tests |
| PAY-003 | redirect remains pending | receipt/payment flow |
| PAY-004 | signed webhook and verify API | webhook tests |
| PAY-005 | idempotent provider events | payment migration |
| PAY-006 | independent state columns | core/order schema |
| PAY-007 | offline payment methods | guest checkout |
| PAY-008 | explicit offline state and completion evidence | order actions |
| PAY-009 | unique payment references | payment migration |
| PAY-010 | authorized refund endpoint | refund route |
| PAY-011 | refund records and statuses | payment migration |
| PAY-012 | server-only secret use | environment runbook and CI |
| FUL-001 | seller delivery methods and fees | fulfillment tests |
| FUL-002 | pickup fulfillment methods | fulfillment tests |
| FUL-003 | active shop-scoped method validation | quote/order APIs |
| FUL-004 | independent fulfillment enum | core schema |
| FUL-005 | constrained order transitions | transition tests |
| FUL-006 | seller fulfillment detail/timeline | order cockpit |
| FUL-007 | buyer-safe tracking language | receipt page |
| ORD-001 | seller dashboard new-order priority | dashboard build |
| ORD-002 | completed value/count cards | dashboard build |
| ORD-003 | order search and state filter | orders page |
| ORD-004 | immutable lines and buyer/fulfillment detail | order page |
| ORD-005 | random public reference and tracking token | order migration |
| ORD-006 | versioned mutations and events | order actions |
| ORD-007 | buyer-visible event projection | tracking API |
| NOT-001 | immediate secure receipt redirect | checkout/receipt flow |
| NOT-002 | unguessable tracking token | order migration |
| NOT-003 | no-store token lookup | tracking API |
| NOT-004 | order/payment event notifications | notification migration |
| NOT-005 | seller in-app and email outbox | notification migration |
| NOT-006 | consent-gated WhatsApp helper | outbox tests |
| NOT-007 | buyer-initiated WhatsApp | receipt page |
| NOT-008 | independent retrying outbox | outbox tests |
| CUS-001 | seller-scoped customers | order migration |
| CUS-002 | transactional order authority | immutable buyer/order snapshot |
| CUS-003 | purpose/source/status consent records | order migration |
| CUS-004 | withdrawn marketing state | checkout consent upsert |
| GRO-001 | visits/views/checkout/orders/completion metrics | analytics tests |
| GRO-002 | visible definitions and reporting period | growth page |
| GRO-003 | privacy-minimized event dimensions | analytics schema |
| BIL-001 | versioned plans and entitlements | core database tests |
| BIL-002 | free-plan product entitlement | core seed/schema |
| OPS-001 | operator-only routes and RLS | admin layout/RLS |
| OPS-002 | support case queue and detail | admin pages |
| OPS-003 | structured risk actions | admin actions |
| OPS-004 | explicit destructive confirmation | seller risk page |
| OPS-005 | append-only audit events | core database tests |
| OPS-006 | payment and notification runbooks | `docs/runbooks` |
| OPS-007 | backup/restore procedure | backup runbook |
| OPS-008 | incident response procedure | incident runbook |
