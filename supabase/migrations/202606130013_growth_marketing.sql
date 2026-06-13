create type public.discount_kind as enum ('fixed','percentage');
alter table public.orders add column discount_minor bigint not null default 0 check(discount_minor>=0);
alter table public.orders add column promotion_snapshot jsonb;
alter table public.orders add column campaign_snapshot jsonb;
alter table public.orders drop constraint orders_totals_check;
alter table public.orders add constraint orders_totals_check check(subtotal_minor>=0 and discount_minor between 0 and subtotal_minor and delivery_minor>=0 and total_minor=subtotal_minor-discount_minor+delivery_minor);

create table public.promotions (
  id uuid primary key default gen_random_uuid(), seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade, code text not null, name text not null,
  kind public.discount_kind not null, value integer not null check(value>0), minimum_minor bigint not null default 0,
  maximum_minor bigint, starts_at timestamptz, ends_at timestamptz, redemption_limit integer, per_customer_limit integer not null default 1,
  active boolean not null default true, created_at timestamptz not null default now(), unique(shop_id,code),
  check(code=upper(code)), check(kind='fixed' or value<=100), check(ends_at is null or starts_at is null or ends_at>starts_at)
);
create table public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(), promotion_id uuid not null references public.promotions(id),
  order_id uuid not null unique references public.orders(id), customer_id uuid not null references public.customers(id),
  seller_account_id uuid not null references public.seller_accounts(id), discount_minor bigint not null, created_at timestamptz not null default now()
);
create table public.campaign_links (
  id uuid primary key default gen_random_uuid(), seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade, name text not null, token text not null unique,
  channel text not null check(channel in ('snapchat','tiktok','instagram','whatsapp','other')), destination_path text not null default '/',
  active boolean not null default true, created_at timestamptz not null default now()
);
create table public.campaign_attributions (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaign_links(id),
  seller_account_id uuid not null references public.seller_accounts(id), order_id uuid unique references public.orders(id),
  session_key text, first_seen_at timestamptz not null default now(), converted_at timestamptz
);
alter table public.promotions enable row level security; alter table public.promotions force row level security;
alter table public.promotion_redemptions enable row level security; alter table public.promotion_redemptions force row level security;
alter table public.campaign_links enable row level security; alter table public.campaign_links force row level security;
alter table public.campaign_attributions enable row level security; alter table public.campaign_attributions force row level security;
create policy promotions_public_read on public.promotions for select to anon,authenticated using(active and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()));
create policy promotions_owner_all on public.promotions for all to authenticated using(seller_account_id=(select public.current_seller_account_id())) with check(seller_account_id=(select public.current_seller_account_id()));
create policy redemptions_owner_read on public.promotion_redemptions for select to authenticated using(seller_account_id=(select public.current_seller_account_id()));
create policy campaigns_public_read on public.campaign_links for select to anon,authenticated using(active);
create policy campaigns_owner_all on public.campaign_links for all to authenticated using(seller_account_id=(select public.current_seller_account_id())) with check(seller_account_id=(select public.current_seller_account_id()));
create policy attributions_owner_read on public.campaign_attributions for select to authenticated using(seller_account_id=(select public.current_seller_account_id()));
grant select on public.promotions,public.campaign_links to anon;
grant select,insert,update,delete on public.promotions,public.campaign_links to authenticated;
grant select on public.promotion_redemptions,public.campaign_attributions to authenticated;
grant all on public.promotions,public.promotion_redemptions,public.campaign_links,public.campaign_attributions to service_role;

create function public.create_guest_order_growth(
  p_shop_id uuid, p_fulfillment_method_id uuid, p_buyer jsonb, p_lines jsonb,
  p_idempotency_key text, p_payment_method text, p_promotion_code text default null,
  p_campaign_token text default null
) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare
  result jsonb;
  order_record public.orders%rowtype;
  promotion_record public.promotions%rowtype;
  campaign_record public.campaign_links%rowtype;
  discount_value bigint := 0;
begin
  result := public.create_guest_order(p_shop_id,p_fulfillment_method_id,p_buyer,p_lines,p_idempotency_key,p_payment_method);
  select * into order_record from public.orders where id=(result->>'orderId')::uuid for update;
  if p_promotion_code is not null and btrim(p_promotion_code)<>'' and not exists(select 1 from public.promotion_redemptions where order_id=order_record.id) then
    select * into promotion_record from public.promotions where shop_id=p_shop_id and code=upper(btrim(p_promotion_code)) and active
      and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()) for update;
    if promotion_record.id is null or order_record.subtotal_minor<promotion_record.minimum_minor then
      raise exception using errcode='P0001',message='Promotion is unavailable.';
    end if;
    if promotion_record.redemption_limit is not null and (select count(*) from public.promotion_redemptions where promotion_id=promotion_record.id)>=promotion_record.redemption_limit then
      raise exception using errcode='P0001',message='Promotion redemption limit reached.';
    end if;
    if (select count(*) from public.promotion_redemptions where promotion_id=promotion_record.id and customer_id=order_record.customer_id)>=promotion_record.per_customer_limit then
      raise exception using errcode='P0001',message='Promotion already used.';
    end if;
    discount_value := case when promotion_record.kind='fixed' then promotion_record.value else floor(order_record.subtotal_minor*promotion_record.value/100.0)::bigint end;
    discount_value := least(order_record.subtotal_minor,discount_value,coalesce(promotion_record.maximum_minor,discount_value));
    update public.orders set discount_minor=discount_value,total_minor=subtotal_minor-discount_value+delivery_minor,
      promotion_snapshot=jsonb_build_object('id',promotion_record.id,'code',promotion_record.code,'name',promotion_record.name,'kind',promotion_record.kind,'value',promotion_record.value)
      where id=order_record.id;
    insert into public.promotion_redemptions(promotion_id,order_id,customer_id,seller_account_id,discount_minor)
      values(promotion_record.id,order_record.id,order_record.customer_id,order_record.seller_account_id,discount_value);
  end if;
  if p_campaign_token is not null and btrim(p_campaign_token)<>'' then
    select * into campaign_record from public.campaign_links where shop_id=p_shop_id and token=lower(btrim(p_campaign_token)) and active;
    if campaign_record.id is not null then
      update public.orders set campaign_snapshot=jsonb_build_object('id',campaign_record.id,'name',campaign_record.name,'token',campaign_record.token,'channel',campaign_record.channel) where id=order_record.id;
      insert into public.campaign_attributions(campaign_id,seller_account_id,order_id,converted_at)
        values(campaign_record.id,order_record.seller_account_id,order_record.id,now()) on conflict(order_id) do nothing;
    end if;
  end if;
  select jsonb_build_object('orderId',id,'reference',public_reference,'trackingToken',tracking_token,'paymentStatus',payment_status,'totalMinor',total_minor,'discountMinor',discount_minor,'currency',currency)
    into result from public.orders where id=order_record.id;
  update public.idempotency_keys set response=result where scope='guest_order' and key=p_idempotency_key;
  return result;
end; $$;
grant execute on function public.create_guest_order_growth(uuid,uuid,jsonb,jsonb,text,text,text,text) to anon,authenticated,service_role;
