create type public.team_role as enum ('manager','catalog','fulfillment','support','analyst');
create table public.team_memberships (
 id uuid primary key default gen_random_uuid(), seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
 auth_user_id uuid not null references auth.users(id) on delete cascade, email text not null, role public.team_role not null,
 active boolean not null default true, created_at timestamptz not null default now(), revoked_at timestamptz, unique(seller_account_id,auth_user_id)
);
create table public.team_invitations (
 id uuid primary key default gen_random_uuid(), seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
 email text not null, role public.team_role not null, token_hash text not null unique, invited_by uuid not null references auth.users(id),
 expires_at timestamptz not null, accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now(),
 check(email=lower(email)), check(expires_at>created_at)
);
alter table public.team_memberships enable row level security;alter table public.team_memberships force row level security;
alter table public.team_invitations enable row level security;alter table public.team_invitations force row level security;
create policy memberships_team_read on public.team_memberships for select to authenticated using(seller_account_id=(select public.current_seller_account_id()) or auth_user_id=auth.uid());
create policy memberships_owner_write on public.team_memberships for all to authenticated using(seller_account_id in(select id from public.seller_accounts where auth_user_id=auth.uid())) with check(seller_account_id in(select id from public.seller_accounts where auth_user_id=auth.uid()));
create policy invitations_owner_all on public.team_invitations for all to authenticated using(seller_account_id in(select id from public.seller_accounts where auth_user_id=auth.uid())) with check(seller_account_id in(select id from public.seller_accounts where auth_user_id=auth.uid()));
grant select on public.team_memberships to authenticated;grant select,insert,update,delete on public.team_invitations,public.team_memberships to authenticated;grant all on public.team_memberships,public.team_invitations to service_role;

create function public.team_has_role(p_seller_account_id uuid,p_roles public.team_role[]) returns boolean language sql stable security definer set search_path='' set row_security=off as $$
 select exists(select 1 from public.team_memberships where seller_account_id=p_seller_account_id and auth_user_id=auth.uid() and active and role=any(p_roles))
$$;
grant execute on function public.team_has_role(uuid,public.team_role[]) to authenticated;

create policy seller_accounts_team_read on public.seller_accounts for select to authenticated using((select public.team_has_role(id,array['manager','catalog','fulfillment','support','analyst']::public.team_role[])));
create policy shops_team_read on public.shops for select to authenticated using((select public.team_has_role(seller_account_id,array['manager','catalog','fulfillment','support','analyst']::public.team_role[])));
create policy products_team_read on public.products for select to authenticated using((select public.team_has_role(seller_account_id,array['manager','catalog','fulfillment','support','analyst']::public.team_role[])));
create policy products_team_write on public.products for all to authenticated using((select public.team_has_role(seller_account_id,array['manager','catalog']::public.team_role[]))) with check((select public.team_has_role(seller_account_id,array['manager','catalog']::public.team_role[])));
create policy variants_team_all on public.product_variants for all to authenticated using((select public.team_has_role(seller_account_id,array['manager','catalog']::public.team_role[]))) with check((select public.team_has_role(seller_account_id,array['manager','catalog']::public.team_role[])));
create policy media_team_all on public.product_media for all to authenticated using((select public.team_has_role(seller_account_id,array['manager','catalog']::public.team_role[]))) with check((select public.team_has_role(seller_account_id,array['manager','catalog']::public.team_role[])));
create policy collections_team_all on public.collections for all to authenticated using((select public.team_has_role(seller_account_id,array['manager','catalog']::public.team_role[]))) with check((select public.team_has_role(seller_account_id,array['manager','catalog']::public.team_role[])));
create policy collection_products_team_all on public.collection_products for all to authenticated using((select public.team_has_role(seller_account_id,array['manager','catalog']::public.team_role[]))) with check((select public.team_has_role(seller_account_id,array['manager','catalog']::public.team_role[])));
create policy inventory_team_read on public.inventory_movements for select to authenticated using((select public.team_has_role(seller_account_id,array['manager','catalog']::public.team_role[])));
create policy orders_team_read on public.orders for select to authenticated using((select public.team_has_role(seller_account_id,array['manager','fulfillment','support']::public.team_role[])));
create policy order_lines_team_read on public.order_lines for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and (select public.team_has_role(o.seller_account_id,array['manager','fulfillment','support']::public.team_role[]))));
create policy order_events_team_read on public.order_events for select to authenticated using((select public.team_has_role(seller_account_id,array['manager','fulfillment','support']::public.team_role[])));
create policy customers_team_read on public.customers for select to authenticated using((select public.team_has_role(seller_account_id,array['manager','support','analyst']::public.team_role[])));
create policy consents_team_read on public.customer_consents for select to authenticated using((select public.team_has_role(seller_account_id,array['manager','support']::public.team_role[])));
create policy fulfillment_team_read on public.fulfillment_methods for select to authenticated using((select public.team_has_role(seller_account_id,array['manager','fulfillment','support']::public.team_role[])));
create policy fulfillment_team_write on public.fulfillment_methods for all to authenticated using((select public.team_has_role(seller_account_id,array['manager','fulfillment']::public.team_role[]))) with check((select public.team_has_role(seller_account_id,array['manager','fulfillment']::public.team_role[])));
create policy analytics_team_read on public.analytics_events for select to authenticated using((select public.team_has_role(seller_account_id,array['manager','catalog','analyst']::public.team_role[])));
