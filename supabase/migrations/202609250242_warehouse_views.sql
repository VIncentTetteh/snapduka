-- Analytics warehouse, vendor-neutral half (ADR-0011).
--
-- The warehouse vendor is not chosen. What can exist today, and must exist
-- whichever vendor wins, is (1) a PII-redacted, pseudonymised read surface that
-- a dbt project runs against, and (2) a publication naming exactly which base
-- columns may ever leave the primary by change data capture. Both are here.
--
-- ── Pseudonymisation ────────────────────────────────────────────────────────
-- Every identifier in the `warehouse` views is an HMAC-SHA256 of the raw uuid
-- (or of a normalised phone number), keyed by a per-environment salt:
--
--     <thing>_key = hex(hmac('<domain>:' || value, salt, 'sha256'))
--
-- The rule is "no raw uuid, no contact detail leaves": a raw seller id is one
-- join away from a name and a phone number in the primary, so a pseudonym that
-- is a plain hash of it would be reversible by anyone who can list seller ids.
-- A keyed hash is not, without the salt. Keys are stable, so marts can join
-- orders to settlements to ledger lines to disputes across views, and the
-- buyer-phone key lets WhatsApp conversations be joined to the orders they led
-- to without either side exposing the number.
--
-- Where the salt lives — decision: a one-row table in a schema only the owner
-- can read (`warehouse_private`), generated from gen_random_bytes at migration
-- time, NOT a Vault secret. Reasons:
--   * The salt only has to be unreadable by the warehouse reader and absent
--     from git; a schema with no grants does that. Vault's encryption key lives
--     in the same database, so it would add ceremony, not a boundary.
--   * The views call the HMAC once per identifier per row. Reading a plain
--     table is cheap; vault.decrypted_secrets decrypts on every read.
--   * Each environment gets its own salt automatically (a local reset gets a
--     fresh one), so pseudonyms are never comparable across environments.
-- Rotating the salt re-keys every pseudonym, which breaks every history the
-- warehouse holds. Do not rotate it except as a deliberate "forget everything"
-- (see docs/adr/0011-analytics-warehouse.md).
--
-- ── Access ──────────────────────────────────────────────────────────────────
-- Views are owned by the migration role and run with its privileges (not
-- security_invoker): that is what lets a reader with no rights on the base
-- tables — and none on warehouse_private — read the redacted projection only.
-- `warehouse_reader` is a NOLOGIN group role; the ELT/CDC login is granted it
-- when a vendor is chosen. anon/authenticated/service_role get nothing, and the
-- schema is not in PostgREST's exposed schemas.
--
-- Excluded everywhere: buyer_snapshot, delivery_address, tracking tokens,
-- public references, payout destinations, provider payloads (`raw`), free text
-- a person typed (case descriptions, resolution notes, review reasons, message
-- previews), delivery-code hashes and rider tokens.

create schema if not exists warehouse_private;
revoke all on schema warehouse_private from public;

create table if not exists warehouse_private.pseudonym_salt (
  singleton boolean primary key default true check (singleton),
  salt bytea not null default extensions.gen_random_bytes(32),
  created_at timestamptz not null default now()
);
insert into warehouse_private.pseudonym_salt (singleton) values (true) on conflict do nothing;
revoke all on warehouse_private.pseudonym_salt from public;

create or replace function warehouse_private.pseudonymise(p_domain text, p_value text)
returns text
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select encode(extensions.hmac(convert_to(p_domain || ':' || p_value, 'UTF8'), s.salt, 'sha256'), 'hex')
    from warehouse_private.pseudonym_salt s;
$$;
revoke all on function warehouse_private.pseudonymise(text, text) from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'warehouse_reader') then
    create role warehouse_reader nologin;
  end if;
end;
$$;

create schema if not exists warehouse;
revoke all on schema warehouse from public;

-- ── Sellers (no names, emails or phones) ────────────────────────────────────
create or replace view warehouse.sellers as
select
  warehouse_private.pseudonymise('seller', s.id::text) as seller_key,
  s.country,
  s.status,
  s.created_at
from public.seller_accounts s;

-- ── Orders ──────────────────────────────────────────────────────────────────
create or replace view warehouse.orders as
select
  warehouse_private.pseudonymise('order', o.id::text) as order_key,
  warehouse_private.pseudonymise('seller', o.seller_account_id::text) as seller_key,
  warehouse_private.pseudonymise('shop', o.shop_id::text) as shop_key,
  warehouse_private.pseudonymise('customer', o.customer_id::text) as customer_key,
  warehouse_private.pseudonymise(
    'phone',
    public.buyer_normalize_phone(o.buyer_snapshot ->> 'phone', o.buyer_snapshot ->> 'country')
  ) as buyer_phone_key,
  -- Country only: coarse enough to aggregate on, useless for identifying.
  o.buyer_snapshot ->> 'country' as buyer_country,
  o.status::text as status,
  o.payment_status::text as payment_status,
  o.fulfillment_status::text as fulfillment_status,
  o.refund_status::text as refund_status,
  o.dispute_status::text as dispute_status,
  o.payment_method,
  o.protection_mode,
  o.currency::text as currency,
  o.subtotal_minor,
  o.discount_minor,
  o.delivery_minor,
  o.protect_fee_minor,
  o.total_minor,
  o.created_at,
  o.updated_at,
  o.fulfilled_at
from public.orders o;

-- ── Settlements ─────────────────────────────────────────────────────────────
create or replace view warehouse.order_settlements as
select
  warehouse_private.pseudonymise('settlement', s.id::text) as settlement_key,
  warehouse_private.pseudonymise('order', s.order_id::text) as order_key,
  warehouse_private.pseudonymise('seller', s.seller_account_id::text) as seller_key,
  s.currency::text as currency,
  s.gross_minor,
  s.platform_fee_bps,
  s.platform_fee_minor,
  s.protect_fee_minor,
  s.psp_fee_minor,
  s.seller_gross_minor,
  s.pending_minor,
  s.released_minor,
  s.clawed_back_minor,
  s.status,
  s.hold_days,
  s.captured_at,
  s.release_at,
  s.released_at,
  s.frozen_at,
  s.frozen_reason,
  s.updated_at
from public.order_settlements s;

-- ── Ledger ──────────────────────────────────────────────────────────────────
-- event_key, reason and metadata are left out: they carry provider references
-- and operator free text. Account kind is what revenue marts need.
create or replace view warehouse.ledger_transactions as
select
  warehouse_private.pseudonymise('ledger_txn', t.id::text) as transaction_key,
  t.kind,
  t.currency::text as currency,
  warehouse_private.pseudonymise('seller', t.seller_account_id::text) as seller_key,
  warehouse_private.pseudonymise('order', t.order_id::text) as order_key,
  warehouse_private.pseudonymise('payout', t.payout_request_id::text) as payout_key,
  warehouse_private.pseudonymise('refund', t.refund_id::text) as refund_key,
  t.posted_at
from public.ledger_transactions t;

create or replace view warehouse.ledger_entries as
select
  warehouse_private.pseudonymise('ledger_entry', e.id::text) as entry_key,
  warehouse_private.pseudonymise('ledger_txn', e.transaction_id::text) as transaction_key,
  a.kind::text as account_kind,
  warehouse_private.pseudonymise('seller', e.seller_account_id::text) as seller_key,
  e.currency::text as currency,
  -- Debit-positive, credit-negative, as in the primary: revenue accounts are
  -- credit-normal, so revenue is the negated sum of their entries.
  e.amount_minor,
  e.created_at
from public.ledger_entries e
join public.ledger_accounts a on a.id = e.account_id;

-- ── Payouts ─────────────────────────────────────────────────────────────────
create or replace view warehouse.payouts as
select
  warehouse_private.pseudonymise('payout', p.id::text) as payout_key,
  warehouse_private.pseudonymise('seller', p.seller_account_id::text) as seller_key,
  p.currency::text as currency,
  p.amount_minor,
  p.fee_minor,
  p.net_minor,
  p.status,
  p.speed,
  p.created_at,
  p.reviewed_at,
  p.paid_at,
  p.not_before,
  p.updated_at
from public.payout_requests p;

-- ── Disputes ────────────────────────────────────────────────────────────────
-- Card/processor chargebacks. `raw` (the provider payload, which can carry the
-- cardholder's email) and the provider's dispute id are left out.
create or replace view warehouse.chargebacks as
select
  warehouse_private.pseudonymise('chargeback', d.id::text) as chargeback_key,
  d.provider,
  warehouse_private.pseudonymise('order', d.order_id::text) as order_key,
  warehouse_private.pseudonymise('seller', d.seller_account_id::text) as seller_key,
  d.currency::text as currency,
  d.amount_minor,
  d.seller_share_minor,
  d.reserved_from,
  d.status,
  d.provider_status,
  d.due_by,
  d.created_at,
  d.updated_at
from public.payment_disputes d;

-- Buyer cases (a case on a protected, unreleased order IS a Protect dispute).
-- The buyer's description and the operator's resolution text are left out.
create or replace view warehouse.support_cases as
select
  warehouse_private.pseudonymise('case', c.id::text) as case_key,
  warehouse_private.pseudonymise('order', c.order_id::text) as order_key,
  warehouse_private.pseudonymise('seller', c.seller_account_id::text) as seller_key,
  c.reason,
  c.status::text as status,
  c.response_due_at,
  c.created_at,
  c.updated_at
from public.support_cases c;

create or replace view warehouse.order_protections as
select
  warehouse_private.pseudonymise('order', p.order_id::text) as order_key,
  warehouse_private.pseudonymise('seller', p.seller_account_id::text) as seller_key,
  p.state::text as state,
  p.state_before_dispute::text as state_before_dispute,
  p.confirmation_method,
  p.code_issued_at,
  p.code_attempts,
  p.held_at,
  p.dispatched_at,
  p.courier_delivered_at,
  p.delivery_confirmed_at,
  p.inspection_ends_at,
  p.auto_release_at,
  p.released_at,
  p.dispatch_overdue_at,
  p.disputed_at,
  p.updated_at
from public.order_protections p;

-- ── Funnel ──────────────────────────────────────────────────────────────────
-- dimensions is safe by construction: analytics_safe_dimensions_check refuses
-- contact and account-number keys at write time.
create or replace view warehouse.analytics_events as
select
  warehouse_private.pseudonymise('analytics_event', e.id::text) as analytics_event_key,
  warehouse_private.pseudonymise('seller', e.seller_account_id::text) as seller_key,
  warehouse_private.pseudonymise('shop', e.shop_id::text) as shop_key,
  warehouse_private.pseudonymise('session', e.session_id::text) as session_key,
  e.event_type,
  warehouse_private.pseudonymise('product', e.product_id::text) as product_key,
  e.source,
  e.campaign,
  e.country::text as country,
  e.dimensions,
  e.created_at
from public.analytics_events e;

-- One row per WhatsApp conversation. The phone becomes the same keyed hash as
-- warehouse.orders.buyer_phone_key (wa buyer_phone is already E.164), so a
-- conversation can be matched to a later order without either exposing it.
create or replace view warehouse.wa_conversations as
select
  warehouse_private.pseudonymise('wa_conversation', c.id::text) as conversation_key,
  warehouse_private.pseudonymise('seller', c.seller_account_id::text) as seller_key,
  warehouse_private.pseudonymise('phone', c.buyer_phone) as buyer_phone_key,
  c.mode,
  c.language,
  c.created_at,
  c.last_inbound_at
from public.wa_conversations c;

-- AI spend and outcomes. `error` and `context` (storage paths, conversation
-- ids) are left out.
create or replace view warehouse.ai_runs as
select
  warehouse_private.pseudonymise('ai_run', r.id::text) as run_key,
  warehouse_private.pseudonymise('seller', r.seller_account_id::text) as seller_key,
  r.purpose,
  r.model,
  r.outcome,
  r.input_tokens,
  r.output_tokens,
  r.cache_read_tokens,
  r.cache_write_tokens,
  r.cost_usd_micros,
  r.latency_ms,
  r.created_at
from public.ai_runs r;

revoke all on all tables in schema warehouse from public, anon, authenticated, service_role;
grant usage on schema warehouse to warehouse_reader;
grant select on all tables in schema warehouse to warehouse_reader;

-- ── CDC publication ─────────────────────────────────────────────────────────
-- Creating a publication costs nothing: no WAL is retained until a
-- replication SLOT is created by a subscriber, and none is created here — that
-- is the vendor decision (ADR-0011), because an unconsumed slot pins WAL until
-- the disk fills.
--
-- Column lists (PG15+) are the PII boundary for CDC: a column not listed never
-- leaves, whatever the subscriber asks for. Each list includes the primary key
-- because a published UPDATE/DELETE needs the replica identity, and an update
-- to a table whose list lacks it FAILS in the primary — pgTAP 093 asserts it.
-- CDC rows carry raw uuids (they are surrogate keys with the contact columns
-- removed); pseudonymising them is the dbt staging layer's job on the vendor
-- side, with the salt held there as a secret. The views above do the same for
-- the Postgres target today.
drop publication if exists warehouse_pub;
create publication warehouse_pub for table
  public.orders (id, shop_id, seller_account_id, customer_id, status, payment_status,
                 fulfillment_status, refund_status, dispute_status, currency, subtotal_minor,
                 discount_minor, delivery_minor, protect_fee_minor, total_minor, payment_method,
                 protection_mode, event_version, created_at, updated_at, fulfilled_at),
  public.order_settlements,
  public.ledger_accounts,
  public.ledger_transactions (id, kind, currency, seller_account_id, order_id,
                              payout_request_id, refund_id, posted_at),
  public.ledger_entries,
  public.payout_requests (id, seller_account_id, amount_minor, fee_minor, net_minor, currency,
                          status, speed, created_at, updated_at, reviewed_at, paid_at, not_before),
  public.payment_disputes (id, provider, order_id, seller_account_id, currency, amount_minor,
                           seller_share_minor, reserved_from, status, provider_status, due_by,
                           created_at, updated_at),
  public.order_protections (order_id, seller_account_id, state, state_before_dispute,
                            confirmation_method, code_issued_at, code_attempts, held_at,
                            dispatched_at, courier_delivered_at, delivery_confirmed_at,
                            inspection_ends_at, auto_release_at, released_at,
                            dispatch_overdue_at, disputed_at, updated_at),
  public.support_cases (id, order_id, seller_account_id, reason, status, response_due_at,
                        created_at, updated_at),
  public.analytics_events,
  public.wa_conversations (id, seller_account_id, mode, language, created_at, last_inbound_at),
  public.seller_accounts (id, country, status, created_at),
  public.ai_runs (id, seller_account_id, purpose, model, outcome, input_tokens, output_tokens,
                  cache_read_tokens, cache_write_tokens, cost_usd_micros, latency_ms, created_at);
