# Growth and Scale Traceability

All P1/P2 product requirements and the Scale release capabilities map to an implementation and verification surface.

| Requirement | Implementation | Verification |
| --- | --- | --- |
| ACC-010 | billing plans and subscription settings | billing state tests and production build |
| SHP-007 | constrained shop branding tokens | branding tests |
| SHP-008 | custom domains and host routing | domain verification tests and migration |
| SHP-009 | opt-in discovery projection | discovery ranking tests and E2E |
| CAT-010 | bounded bulk catalog actions | seller products build |
| CAT-011 | consent-based restock endpoint | retention migration and route validation |
| SOC-005 | named channel campaign links | campaign link tests |
| SOC-006 | immutable campaign order attribution | growth marketing migration and E2E |
| SOC-007 | suggested caption and story-card preview | campaign management page |
| SOC-008 | provider-neutral integration boundaries | courier registry and public API adapters |
| CHK-010 | consent-based abandoned checkout records | retention migration and route validation |
| PAY-013 | settlement reconciliation classes | reconciliation tests |
| FUL-008 | courier quote, booking, event, and tracking model | courier contract tests |
| ORD-008 | filtered CSV and bounded bulk actions | CSV tests and export route |
| NOT-009 | supplementary push subscriptions | push route and retention migration |
| NOT-010 | seller notification preferences | notification settings workflow |
| CUS-005 | customer aggregates and order history | customer directory/detail pages |
| CUS-006 | aggregate-rule customer segments | segment tests and workflow |
| CUS-007 | delivery-time consent/frequency checks | marketing eligibility tests |
| CUS-008 | seller/product-scoped retention records | retention RLS migration |
| GRO-004 | fixed and percentage promotions | discount tests |
| GRO-005 | server validation and immutable order snapshots | promotion RPC and E2E |
| GRO-006 | funnels, AOV, repeat rate, and top products | advanced analytics tests/page |
| GRO-007 | seller-scoped analytics and exports | RLS and authenticated routes |
| BIL-003 | versioned paid entitlement limits | entitlement tests |
| BIL-004 | configurable country plan prices | growth core migration |
| BIL-005 | separate subscription/provider fee explanation | billing page |
| BIL-006 | downgrade read-only capability preservation | entitlement tests and schema |
| BIL-007 | billing grace and recovery states | subscription tests/webhook |
| OPS-009 | non-punitive risk signals | risk signal tests and operations schema |
| SCALE-I18N | French, CI, XOF, +225, payment filtering | i18n tests and split enum migrations |
| SCALE-TEAM | roles, expiring invites, revocation | permission tests and team workflow |
| SCALE-COURIER | provider adapter and manual fallback | courier contract tests |
| SCALE-API | scoped keys, pagination, rate limits | API key tests and `/api/v1` routes |
| SCALE-WEBHOOK | signed retries and dead letters | webhook signing tests and processor |
| SCALE-AUTOMATION | idempotent bounded rules | automation tests and run schema |
| SCALE-DISCOVERY | deterministic public-safe opt-in index | discovery tests and E2E |
