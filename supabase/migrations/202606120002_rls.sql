create function public.current_seller_account_id()
returns uuid
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select seller_accounts.id
  from public.seller_accounts
  where seller_accounts.auth_user_id = auth.uid()
  limit 1
$$;

create function public.current_seller_status()
returns public.seller_account_status
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select seller_accounts.status
  from public.seller_accounts
  where seller_accounts.auth_user_id = auth.uid()
  limit 1
$$;

create function public.is_operator()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'snapduka_role' = 'operator',
    false
  )
$$;

alter table public.country_configs enable row level security;
alter table public.country_configs force row level security;
alter table public.plans enable row level security;
alter table public.plans force row level security;
alter table public.seller_accounts enable row level security;
alter table public.seller_accounts force row level security;
alter table public.shops enable row level security;
alter table public.shops force row level security;
alter table public.seller_verifications enable row level security;
alter table public.seller_verifications force row level security;
alter table public.payment_subaccounts enable row level security;
alter table public.payment_subaccounts force row level security;
alter table public.seller_entitlements enable row level security;
alter table public.seller_entitlements force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

create policy country_configs_public_read
on public.country_configs
for select
to anon, authenticated
using (enabled);

create policy country_configs_operator_read
on public.country_configs
for select
to authenticated
using ((select public.is_operator()));

create policy plans_active_read
on public.plans
for select
to anon, authenticated
using (active);

create policy plans_operator_read
on public.plans
for select
to authenticated
using ((select public.is_operator()));

create policy seller_accounts_owner_or_operator_read
on public.seller_accounts
for select
to authenticated
using (
  id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

create policy seller_accounts_owner_update
on public.seller_accounts
for update
to authenticated
using (id = (select public.current_seller_account_id()))
with check (id = (select public.current_seller_account_id()));

create policy shops_public_read
on public.shops
for select
to anon, authenticated
using (status = 'published');

create policy shops_owner_operator_read
on public.shops
for select
to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

create policy shops_owner_insert
on public.shops
for insert
to authenticated
with check (
  seller_account_id = (select public.current_seller_account_id())
  and status = 'draft'
  and (select public.current_seller_status()) in ('pending', 'active')
);

create policy shops_owner_update
on public.shops
for update
to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and status not in ('suspended', 'closed')
)
with check (
  seller_account_id = (select public.current_seller_account_id())
  and (
    (
      (select public.current_seller_status()) = 'pending'
      and status = 'draft'
    )
    or (
      (select public.current_seller_status()) = 'active'
      and status in ('draft', 'pending_review', 'published')
    )
  )
);

create policy seller_verifications_owner_operator_read
on public.seller_verifications
for select
to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

create policy seller_verifications_owner_insert
on public.seller_verifications
for insert
to authenticated
with check (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and state in ('not_started', 'in_progress', 'needs_action')
  and provider is null
  and provider_reference is null
  and checked_at is null
  and expires_at is null
);

create policy seller_verifications_owner_update
on public.seller_verifications
for update
to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and state in ('not_started', 'in_progress', 'needs_action')
)
with check (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and state in ('not_started', 'in_progress', 'needs_action')
  and provider is null
  and provider_reference is null
  and checked_at is null
  and expires_at is null
);

create policy payment_subaccounts_owner_operator_read
on public.payment_subaccounts
for select
to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

create policy payment_subaccounts_owner_insert
on public.payment_subaccounts
for insert
to authenticated
with check (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and provider = 'paystack'
  and status = 'pending'
  and provider_subaccount_id is null
  and provider_subaccount_code is null
  and request_fingerprint is null
);

create policy payment_subaccounts_owner_update
on public.payment_subaccounts
for update
to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and provider = 'paystack'
  and status = 'pending'
)
with check (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and provider = 'paystack'
  and status = 'pending'
  and provider_subaccount_id is null
  and provider_subaccount_code is null
  and request_fingerprint is null
);

create policy seller_entitlements_owner_operator_read
on public.seller_entitlements
for select
to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);

create policy seller_entitlements_owner_insert
on public.seller_entitlements
for insert
to authenticated
with check (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and exists (
    select 1
    from public.plans
    where plans.id = seller_entitlements.plan_id
      and plans.version = seller_entitlements.version
      and plans.entitlements = seller_entitlements.entitlements
      and plans.code = 'free'
      and plans.active
  )
);

create policy seller_entitlements_owner_update
on public.seller_entitlements
for update
to authenticated
using (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
)
with check (
  seller_account_id = (select public.current_seller_account_id())
  and (select public.current_seller_status()) in ('pending', 'active')
  and exists (
    select 1
    from public.plans
    where plans.id = seller_entitlements.plan_id
      and plans.version = seller_entitlements.version
      and plans.entitlements = seller_entitlements.entitlements
      and plans.code = 'free'
      and plans.active
  )
);

create policy audit_events_operator_read
on public.audit_events
for select
to authenticated
using ((select public.is_operator()));

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;

grant select on public.country_configs, public.plans, public.shops to anon;

grant select on
  public.country_configs,
  public.plans,
  public.seller_accounts,
  public.shops,
  public.seller_verifications,
  public.payment_subaccounts,
  public.seller_entitlements,
  public.audit_events
to authenticated;

grant update (
  contact_name,
  contact_email,
  contact_phone
) on public.seller_accounts to authenticated;

grant insert (
  seller_account_id,
  slug,
  display_name,
  legal_name,
  registration_number,
  country,
  currency,
  status,
  published_at,
  unpublished_at
) on public.shops to authenticated;

grant update (
  slug,
  display_name,
  legal_name,
  registration_number,
  status,
  published_at,
  unpublished_at
) on public.shops to authenticated;

grant insert (
  seller_account_id,
  state,
  metadata
) on public.seller_verifications to authenticated;

grant update (
  state,
  metadata
) on public.seller_verifications to authenticated;

grant insert (
  seller_account_id,
  provider,
  metadata
) on public.payment_subaccounts to authenticated;

grant update (
  metadata
) on public.payment_subaccounts to authenticated;

grant insert (
  seller_account_id,
  plan_id,
  version,
  entitlements
) on public.seller_entitlements to authenticated;

grant update (
  plan_id,
  version,
  entitlements
) on public.seller_entitlements to authenticated;

grant execute on function public.current_seller_account_id() to authenticated;
grant execute on function public.current_seller_status() to authenticated;
grant execute on function public.is_operator() to authenticated;
grant execute on function public.write_audit_event(
  public.actor_type,
  uuid,
  text,
  text,
  uuid,
  jsonb,
  jsonb,
  jsonb
) to service_role;

grant all on
  public.country_configs,
  public.plans,
  public.seller_accounts,
  public.shops,
  public.seller_verifications,
  public.payment_subaccounts,
  public.seller_entitlements
to service_role;

revoke update, delete, truncate on public.audit_events from service_role;
grant select, insert on public.audit_events to service_role;

-- Future order, customer, payment, and dispute tables must start with forced
-- RLS and no anonymous SELECT policy; public buyers must never enumerate them.
