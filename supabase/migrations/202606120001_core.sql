create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema extensions;

create type public.country_code as enum ('GH', 'NG');
create type public.currency_code as enum ('GHS', 'NGN');
create type public.verification_state as enum (
  'not_started',
  'in_progress',
  'needs_action',
  'verified',
  'rejected',
  'suspended'
);
create type public.seller_account_status as enum (
  'pending',
  'active',
  'suspended',
  'closed'
);
create type public.shop_status as enum (
  'draft',
  'pending_review',
  'published',
  'suspended',
  'closed'
);
create type public.product_status as enum ('draft', 'active', 'archived');
create type public.inventory_policy as enum (
  'track',
  'continue_selling',
  'deny_when_out_of_stock'
);
create type public.order_status as enum (
  'draft',
  'pending',
  'confirmed',
  'processing',
  'completed',
  'cancelled'
);
create type public.payment_status as enum (
  'unpaid',
  'pending',
  'paid',
  'failed',
  'partially_refunded',
  'refunded',
  'offline_due'
);
create type public.fulfillment_status as enum (
  'unconfirmed',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'dispatched',
  'fulfilled',
  'cancelled',
  'returned'
);
create type public.refund_status as enum (
  'none',
  'requested',
  'processing',
  'partial',
  'completed',
  'failed'
);
create type public.dispute_status as enum (
  'none',
  'opened',
  'seller_response_due',
  'under_review',
  'resolved',
  'closed'
);
create type public.consent_status as enum (
  'pending',
  'granted',
  'withdrawn',
  'expired'
);
create type public.notification_status as enum (
  'pending',
  'queued',
  'sent',
  'delivered',
  'failed',
  'read'
);
create type public.actor_type as enum (
  'system',
  'user',
  'seller',
  'admin',
  'provider'
);
create type public.payment_subaccount_status as enum (
  'pending',
  'active',
  'restricted',
  'disabled'
);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create function public.prevent_audit_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'audit_events are append-only';
end;
$$;

create function public.prevent_plan_version_payload_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.code is distinct from old.code
    or new.name is distinct from old.name
    or new.version is distinct from old.version
    or new.entitlements is distinct from old.entitlements
  then
    raise exception using
      errcode = '55000',
      message = 'plan version payload is immutable';
  end if;

  return new;
end;
$$;

create table public.country_configs (
  country public.country_code primary key,
  currency public.currency_code not null,
  calling_code text not null,
  address_fields text[] not null,
  address_config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint country_configs_country_currency_key unique (country, currency),
  constraint country_configs_calling_code_key unique (calling_code),
  constraint country_configs_calling_code_check
    check (calling_code ~ '^\+[1-9][0-9]{1,3}$'),
  constraint country_configs_address_fields_check
    check (address_fields = array['line1', 'area', 'city', 'region']::text[]),
  constraint country_configs_address_config_check
    check (jsonb_typeof(address_config) = 'object')
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  version integer not null,
  entitlements jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_id_version_key unique (id, version),
  constraint plans_code_version_key unique (code, version),
  constraint plans_code_check check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint plans_name_check check (btrim(name) <> ''),
  constraint plans_version_check check (version > 0),
  constraint plans_entitlements_check
    check (jsonb_typeof(entitlements) = 'object')
);

create unique index plans_one_active_version_per_code_idx
  on public.plans (code)
  where active;

create table public.seller_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  country public.country_code not null,
  status public.seller_account_status not null default 'pending',
  is_active boolean not null default false,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_accounts_auth_user_id_key unique (auth_user_id),
  constraint seller_accounts_id_country_key unique (id, country),
  constraint seller_accounts_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users (id) on delete cascade,
  constraint seller_accounts_country_fkey
    foreign key (country) references public.country_configs (country),
  constraint seller_accounts_active_status_check
    check ((status = 'active') = is_active),
  constraint seller_accounts_contact_name_check check (btrim(contact_name) <> ''),
  constraint seller_accounts_contact_email_check
    check (
      contact_email = lower(contact_email)
      and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint seller_accounts_contact_phone_check
    check (
      contact_phone is null
      or contact_phone ~ '^\+[1-9][0-9]{7,14}$'
    )
);

create index seller_accounts_country_status_idx
  on public.seller_accounts (country, status);

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null,
  slug text not null,
  display_name text not null,
  legal_name text,
  registration_number text,
  country public.country_code not null,
  currency public.currency_code not null,
  status public.shop_status not null default 'draft',
  published_at timestamptz,
  unpublished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shops_seller_account_id_key unique (seller_account_id),
  constraint shops_slug_key unique (slug),
  constraint shops_slug_format_check
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint shops_display_name_check check (btrim(display_name) <> ''),
  constraint shops_published_at_check
    check (status <> 'published' or published_at is not null),
  constraint shops_seller_country_fkey
    foreign key (seller_account_id, country)
    references public.seller_accounts (id, country)
    on delete cascade,
  constraint shops_country_currency_fkey
    foreign key (country, currency)
    references public.country_configs (country, currency)
);

create index shops_status_published_at_idx
  on public.shops (status, published_at desc);

create table public.seller_verifications (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null,
  state public.verification_state not null default 'not_started',
  provider text,
  provider_reference text,
  metadata jsonb not null default '{}'::jsonb,
  checked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_verifications_seller_account_id_key
    unique (seller_account_id),
  constraint seller_verifications_seller_account_id_fkey
    foreign key (seller_account_id)
    references public.seller_accounts (id)
    on delete cascade,
  constraint seller_verifications_provider_reference_key
    unique (provider, provider_reference),
  constraint seller_verifications_provider_check
    check (provider is null or btrim(provider) <> ''),
  constraint seller_verifications_provider_reference_check
    check (provider_reference is null or btrim(provider_reference) <> ''),
  constraint seller_verifications_verified_fields_check
    check (
      state <> 'verified'
      or (
        provider is not null
        and provider_reference is not null
        and checked_at is not null
      )
    ),
  constraint seller_verifications_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint seller_verifications_expiry_check
    check (
      expires_at is null
      or checked_at is null
      or expires_at > checked_at
    )
);

create index seller_verifications_state_expiry_idx
  on public.seller_verifications (state, expires_at);

create table public.payment_subaccounts (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null,
  provider text not null,
  provider_subaccount_id text,
  provider_subaccount_code text,
  status public.payment_subaccount_status not null default 'pending',
  request_fingerprint text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_subaccounts_seller_provider_key
    unique (seller_account_id, provider),
  constraint payment_subaccounts_seller_account_id_fkey
    foreign key (seller_account_id)
    references public.seller_accounts (id)
    on delete cascade,
  constraint payment_subaccounts_provider_id_key
    unique (provider, provider_subaccount_id),
  constraint payment_subaccounts_provider_code_key
    unique (provider, provider_subaccount_code),
  constraint payment_subaccounts_request_fingerprint_key
    unique (provider, request_fingerprint),
  constraint payment_subaccounts_provider_check check (btrim(provider) <> ''),
  constraint payment_subaccounts_provider_id_check
    check (
      provider_subaccount_id is null
      or btrim(provider_subaccount_id) <> ''
    ),
  constraint payment_subaccounts_provider_code_check
    check (
      provider_subaccount_code is null
      or btrim(provider_subaccount_code) <> ''
    ),
  constraint payment_subaccounts_request_fingerprint_check
    check (
      request_fingerprint is null
      or btrim(request_fingerprint) <> ''
    ),
  constraint payment_subaccounts_active_fields_check
    check (
      status <> 'active'
      or (
        provider_subaccount_id is not null
        and provider_subaccount_code is not null
      )
    ),
  constraint payment_subaccounts_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create index payment_subaccounts_status_idx
  on public.payment_subaccounts (status);

create table public.seller_entitlements (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null,
  plan_id uuid not null,
  version integer not null,
  entitlements jsonb not null,
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_entitlements_assignment_key
    unique (seller_account_id, plan_id, effective_at),
  constraint seller_entitlements_seller_account_id_fkey
    foreign key (seller_account_id)
    references public.seller_accounts (id)
    on delete cascade,
  constraint seller_entitlements_plan_version_fkey
    foreign key (plan_id, version) references public.plans (id, version),
  constraint seller_entitlements_version_check check (version > 0),
  constraint seller_entitlements_entitlements_check
    check (jsonb_typeof(entitlements) = 'object'),
  constraint seller_entitlements_expiry_check
    check (expires_at is null or expires_at > effective_at)
);

create index seller_entitlements_current_idx
  on public.seller_entitlements (seller_account_id, effective_at desc, expires_at);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_type public.actor_type not null,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint audit_events_actor_check
    check (actor_type = 'system' or actor_id is not null),
  constraint audit_events_action_check check (btrim(action) <> ''),
  constraint audit_events_entity_type_check check (btrim(entity_type) <> ''),
  constraint audit_events_before_data_check
    check (before_data is null or jsonb_typeof(before_data) = 'object'),
  constraint audit_events_after_data_check
    check (after_data is null or jsonb_typeof(after_data) = 'object'),
  constraint audit_events_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_entity_timeline_idx
  on public.audit_events (entity_type, entity_id, occurred_at desc);

create index audit_events_actor_timeline_idx
  on public.audit_events (actor_type, actor_id, occurred_at desc);

create function public.write_audit_event(
  p_actor_type public.actor_type,
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_before_data jsonb default null,
  p_after_data jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  event_id uuid;
begin
  insert into public.audit_events (
    actor_type,
    actor_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  )
  values (
    p_actor_type,
    p_actor_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_before_data,
    p_after_data,
    p_metadata
  )
  returning id into event_id;

  return event_id;
end;
$$;

create trigger country_configs_set_updated_at
before update on public.country_configs
for each row execute function public.set_updated_at();

create trigger plans_set_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

create trigger plans_prevent_version_payload_mutation
before update on public.plans
for each row execute function public.prevent_plan_version_payload_mutation();

create trigger seller_accounts_set_updated_at
before update on public.seller_accounts
for each row execute function public.set_updated_at();

create trigger shops_set_updated_at
before update on public.shops
for each row execute function public.set_updated_at();

create trigger seller_verifications_set_updated_at
before update on public.seller_verifications
for each row execute function public.set_updated_at();

create trigger payment_subaccounts_set_updated_at
before update on public.payment_subaccounts
for each row execute function public.set_updated_at();

create trigger seller_entitlements_set_updated_at
before update on public.seller_entitlements
for each row execute function public.set_updated_at();

create trigger audit_events_prevent_update
before update on public.audit_events
for each row execute function public.prevent_audit_event_mutation();

create trigger audit_events_prevent_delete
before delete on public.audit_events
for each row execute function public.prevent_audit_event_mutation();

insert into public.country_configs (
  country,
  currency,
  calling_code,
  address_fields,
  address_config
)
values
  (
    'GH',
    'GHS',
    '+233',
    array['line1', 'area', 'city', 'region'],
    '{"regionLabel":"Region"}'::jsonb
  ),
  (
    'NG',
    'NGN',
    '+234',
    array['line1', 'area', 'city', 'region'],
    '{"regionLabel":"State"}'::jsonb
  );

insert into public.plans (
  code,
  name,
  version,
  entitlements,
  active
)
values (
  'free',
  'Free',
  1,
  '{
    "shops": 1,
    "products": 50,
    "staffAccounts": 1,
    "customDomain": false
  }'::jsonb,
  true
);
