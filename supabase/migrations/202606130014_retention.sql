create table public.customer_segments (
 id uuid primary key default gen_random_uuid(), seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
 name text not null, rules jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.marketing_broadcasts (
 id uuid primary key default gen_random_uuid(), seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
 segment_id uuid references public.customer_segments(id), channel text not null check(channel in ('email','whatsapp','push')),
 subject text, body text not null, state text not null default 'draft' check(state in ('draft','scheduled','sending','sent','cancelled')),
 scheduled_at timestamptz, created_at timestamptz not null default now()
);
create table public.marketing_deliveries (
 id uuid primary key default gen_random_uuid(), broadcast_id uuid not null references public.marketing_broadcasts(id) on delete cascade,
 customer_id uuid not null references public.customers(id), seller_account_id uuid not null references public.seller_accounts(id),
 state text not null default 'queued' check(state in ('queued','sent','skipped','failed')), reason text, sent_at timestamptz, unique(broadcast_id,customer_id)
);
create table public.restock_requests (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade,
 seller_account_id uuid not null references public.seller_accounts(id), email text, phone text, consent boolean not null default false,
 notified_at timestamptz, created_at timestamptz not null default now(), check(email is not null or phone is not null)
);
create table public.abandoned_checkouts (
 id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id), seller_account_id uuid not null references public.seller_accounts(id),
 contact text not null, cart_snapshot jsonb not null, campaign_token text, consent boolean not null default false,
 recovered_order_id uuid references public.orders(id), remind_after timestamptz not null, reminded_at timestamptz, created_at timestamptz not null default now()
);
create table public.notification_preferences (
 seller_account_id uuid primary key references public.seller_accounts(id) on delete cascade,
 order_email boolean not null default true, order_whatsapp boolean not null default false, digest_frequency text not null default 'daily' check(digest_frequency in ('instant','daily','weekly','off')),
 marketing_frequency_cap integer not null default 4 check(marketing_frequency_cap between 0 and 31), updated_at timestamptz not null default now()
);
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(), seller_account_id uuid references public.seller_accounts(id) on delete cascade,
 customer_id uuid references public.customers(id) on delete cascade, endpoint text not null unique, p256dh text not null, auth text not null,
 active boolean not null default true, created_at timestamptz not null default now(), check(seller_account_id is not null or customer_id is not null)
);
do $$ declare t text; begin foreach t in array array['customer_segments','marketing_broadcasts','marketing_deliveries','restock_requests','abandoned_checkouts','notification_preferences','push_subscriptions'] loop execute format('alter table public.%I enable row level security',t); execute format('alter table public.%I force row level security',t); end loop; end $$;
create policy segments_owner_all on public.customer_segments for all to authenticated using(seller_account_id=(select public.current_seller_account_id())) with check(seller_account_id=(select public.current_seller_account_id()));
create policy broadcasts_owner_all on public.marketing_broadcasts for all to authenticated using(seller_account_id=(select public.current_seller_account_id())) with check(seller_account_id=(select public.current_seller_account_id()));
create policy deliveries_owner_read on public.marketing_deliveries for select to authenticated using(seller_account_id=(select public.current_seller_account_id()));
create policy restock_public_insert on public.restock_requests for insert to anon,authenticated with check(consent);
create policy restock_owner_read on public.restock_requests for select to authenticated using(seller_account_id=(select public.current_seller_account_id()));
create policy abandoned_public_insert on public.abandoned_checkouts for insert to anon,authenticated with check(consent);
create policy abandoned_owner_read on public.abandoned_checkouts for select to authenticated using(seller_account_id=(select public.current_seller_account_id()));
create policy preferences_owner_all on public.notification_preferences for all to authenticated using(seller_account_id=(select public.current_seller_account_id())) with check(seller_account_id=(select public.current_seller_account_id()));
create policy push_own_insert on public.push_subscriptions for insert to anon,authenticated with check(true);
grant insert on public.restock_requests,public.abandoned_checkouts,public.push_subscriptions to anon,authenticated;
grant select,insert,update,delete on public.customer_segments,public.marketing_broadcasts,public.notification_preferences to authenticated;
grant select on public.marketing_deliveries,public.restock_requests,public.abandoned_checkouts to authenticated;
grant all on public.customer_segments,public.marketing_broadcasts,public.marketing_deliveries,public.restock_requests,public.abandoned_checkouts,public.notification_preferences,public.push_subscriptions to service_role;
