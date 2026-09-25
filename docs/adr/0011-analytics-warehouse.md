# ADR-0011: Analytics warehouse via change data capture

**Status**: Accepted (vendor-neutral half built; vendor and replication slot open)
**Date**: 2026-09-25
**Authors**: @VIncentTetteh

## Context

All analytics run in the transactional database. The db.max_rows cap has
already caused dashboards to report wrong numbers when rows were counted in
JavaScript, and credit scoring for stock financing will need history the OLTP
database should not serve. The roadmap's metrics (weekly transacting sellers,
Protect GMV, take rate, dispute and chargeback rates, delivery-code
confirmation, AI listing acceptance, WhatsApp conversation-to-checkout) need a
modelled, PII-free layer whichever warehouse is eventually chosen.

## Decision

1. **Operational numbers stay in SQL functions.** Admin and seller dashboards
   aggregate in SECURITY INVOKER functions granted to service_role only
   (`admin_north_star`, `admin_order_totals_since`, `admin_seller_gmv`, ...),
   never by counting rows in application code.

2. **A redacted, pseudonymised read surface in the primary** — the `warehouse`
   schema (migration `202609250242_warehouse_views.sql`): views over orders,
   settlements, ledger transactions and entries, payouts, chargebacks, buyer
   cases, Protect state, analytics events, WhatsApp conversations, AI runs and
   sellers.
   - No contact details, free text, tokens or provider payloads are columns.
   - No raw uuid leaves: every identifier is `hex(HMAC-SHA256('<domain>:' || id, salt))`.
     A plain hash of a uuid is reversible by anyone who can enumerate ids; a
     keyed hash is not. Keys are stable, so marts join across views; the buyer
     phone key lets WhatsApp conversations match orders without the number.
   - **Salt: a one-row table in `warehouse_private`, not Vault.** Generated from
     `gen_random_bytes(32)` when the migration runs, so each environment has its
     own and it never appears in git. Only the owner can read that schema.
     Vault's key lives in the same database, so it would add ceremony rather
     than a boundary, and the views would decrypt on every call. **Never rotate
     it** except as a deliberate "forget all history": rotation re-keys every
     pseudonym.
   - Readers: the NOLOGIN group role `warehouse_reader` (usage on `warehouse`,
     select on its views, nothing on `warehouse_private` or the base tables).
     No API role (anon, authenticated, service_role) can read the views, and the
     schema is not exposed through PostgREST.

3. **The CDC boundary is a publication with column lists** — `warehouse_pub`
   over 13 base tables, each with an explicit column list that omits every
   contact and free-text column and includes the primary key (a list without
   the replica identity makes UPDATEs on that table fail in the primary; pgTAP
   093 asserts it). Tables that are contact data through and through
   (customers, buyer_profiles, wa_messages) are not published at all. CDC rows
   carry raw surrogate uuids; the vendor-side dbt staging layer must apply the
   same HMAC with the salt held as a vendor secret.

4. **dbt, vendor-neutral** — `warehouse/` holds a dbt project (staging views,
   seven marts) written in plain SQL plus dbt's cross-database macros
   (`dbt.date_trunc`, `dbt.dateadd`): no `::` casts, no `FILTER`, no bare
   `UNION`. `profiles.yml.example` has a `postgres` target pointing at local
   Supabase. dbt is not installed in the repo yet;
   `python3 warehouse/scripts/check_models.py --verify` renders the models the
   way dbt-postgres would, creates them in a scratch schema, seeds fixtures
   through the real money paths, asserts every mart's numbers, and rolls back.

5. **Server-side funnel events** (migration `202609250241`):
   `checkout_completed`, `protect_opted_in`, `delivery_confirmed`,
   `wa_conversation_started`, `payout_instant_requested` are recorded by
   triggers and the `protect.delivered` outbox handler through
   `record_server_analytics_event`, idempotently. They are not accepted by the
   public ingestion route. `listing_ai_accepted` is allowed but not yet
   recorded (no server hook).

## What exists

| Piece | Where |
|---|---|
| Admin aggregates | `supabase/migrations/202609250240_admin_overview_aggregates.sql` |
| Funnel events | `supabase/migrations/202609250241_analytics_funnel_events.sql`, `src/lib/analytics/handlers.ts` |
| Warehouse views, salt, reader role, publication | `supabase/migrations/202609250242_warehouse_views.sql` |
| dbt project | `warehouse/` (models/staging, models/marts, scripts/check_models.py) |
| Tests | pgTAP 090-093; `check_models.py --verify` |

## What remains

- **Vendor.** Datastream→BigQuery vs PeerDB/Airbyte→ClickHouse (or a
  query-based ELT reading the `warehouse` views, which needs no slot and keeps
  pseudonymisation in the primary). Decide on cost at expected volume and
  whether CDC latency is needed at all; a nightly view-based load may suffice.
- **Replication slot.** Created by the chosen connector, never by a migration.
  Before creating it: slot-lag / retained-WAL alerting, and
  `max_slot_wal_keep_size` set so an abandoned slot cannot fill the disk.
- **A login role for the connector** granted `warehouse_reader` (view-based) or
  REPLICATION plus `warehouse_pub` (CDC); credentials in the secret store.
- **Vendor-side pseudonymisation** for CDC-sourced rows (salt as a vendor
  secret), and a DPA with the vendor.
- **`listing_ai_accepted`** needs a seller-authenticated server hook (e.g. the
  product-create route receiving the draft's `ai_runs` id).
- **dbt in CI** once a vendor is chosen (`dbt build` against the Postgres
  target); until then run `check_models.py --verify` in CI.

## Consequences

### Positive
- Metric definitions are fixed and tested before a vendor is chosen.
- PII cannot leave through the warehouse surface by omission: the views and
  the publication list what may leave, not what may not.

### Negative
- The views compute an HMAC per identifier per row; fine for batch loads,
  too slow for ad-hoc scans of the full ledger on the primary.
- Two pseudonymisation paths (views for the Postgres target, vendor staging for
  CDC) must use the same domains and salt.

## Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Replication slot fills disk | Med | High | No slot until the vendor decision; lag alerting and `max_slot_wal_keep_size` first |
| PII leaves the primary store | Med | High | Views and publication column lists are allow-lists; pgTAP 092/093 assert no contact columns; DPA with vendor |
| Salt leaked or rotated | Low | High | Owner-only schema; ADR forbids rotation except as deliberate forgetting |
| A column added to a published table leaks | Low | Med | Tables with contact data have explicit column lists, so a new column there is NOT published until listed; the four list-less tables (settlements, ledger accounts/entries, analytics_events) hold no contact data — pgTAP 093 re-checks the published columns |
| Heavy analytics load on the primary | Med | Med | Load marts off-primary once a vendor exists; views are not for dashboards |
