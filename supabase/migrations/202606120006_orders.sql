create table public.customers (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  name text not null,
  email text not null,
  phone text not null,
  country public.country_code not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_seller_email_key unique (seller_account_id, email),
  constraint customers_email_check check (email = lower(email)),
  constraint customers_phone_check check (phone ~ '^\+[1-9][0-9]{7,14}$')
);

create table public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  purpose text not null,
  status public.consent_status not null,
  captured_at timestamptz not null default now(),
  source text not null default 'checkout',
  constraint customer_consents_customer_purpose_key unique (customer_id, purpose)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  seller_account_id uuid not null references public.seller_accounts(id),
  customer_id uuid not null references public.customers(id),
  public_reference text not null unique default ('SD-' || upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12))),
  tracking_token uuid not null unique default gen_random_uuid(),
  status public.order_status not null default 'pending',
  payment_status public.payment_status not null default 'unpaid',
  fulfillment_status public.fulfillment_status not null default 'unconfirmed',
  refund_status public.refund_status not null default 'none',
  dispute_status public.dispute_status not null default 'none',
  currency public.currency_code not null,
  subtotal_minor bigint not null,
  delivery_minor bigint not null,
  total_minor bigint not null,
  payment_method text not null,
  fulfillment_method_snapshot jsonb not null,
  buyer_snapshot jsonb not null,
  event_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_totals_check check (
    subtotal_minor >= 0 and delivery_minor >= 0 and total_minor = subtotal_minor + delivery_minor
  ),
  constraint orders_payment_method_check check (
    payment_method in ('paystack','cash_on_delivery','pay_on_pickup','seller_arranged')
  )
);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  product_name text not null,
  variant_name text,
  sku text,
  unit_price_minor bigint not null,
  quantity integer not null,
  line_total_minor bigint not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint order_lines_quantity_check check (quantity > 0),
  constraint order_lines_total_check check (line_total_minor = unit_price_minor * quantity)
);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts(id),
  event_type text not null,
  actor_type public.actor_type not null,
  actor_id uuid,
  buyer_visible boolean not null default true,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  key text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint idempotency_keys_scope_key unique (scope, key)
);

create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();

create function public.prevent_order_line_mutation() returns trigger language plpgsql set search_path = '' as $$
begin raise exception using errcode = '55000', message = 'Order line snapshots are immutable.'; end; $$;
create trigger order_lines_no_update before update or delete on public.order_lines
for each row execute function public.prevent_order_line_mutation();

create function public.create_guest_order(
  p_shop_id uuid,
  p_fulfillment_method_id uuid,
  p_buyer jsonb,
  p_lines jsonb,
  p_idempotency_key text,
  p_payment_method text
) returns jsonb
language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  existing jsonb;
  shop_record public.shops%rowtype;
  method_record public.fulfillment_methods%rowtype;
  product_record public.products%rowtype;
  variant_record public.product_variants%rowtype;
  line jsonb;
  v_customer_id uuid;
  v_order_id uuid;
  subtotal bigint := 0;
  unit_price bigint;
  quantity integer;
  result jsonb;
begin
  if btrim(coalesce(p_idempotency_key,'')) = '' or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode='22023', message='Invalid order request.';
  end if;
  select response into existing from public.idempotency_keys
    where scope = 'guest_order' and key = p_idempotency_key and expires_at > now();
  if existing is not null then return existing; end if;

  select * into shop_record from public.shops where id=p_shop_id and status='published';
  select * into method_record from public.fulfillment_methods
    where id=p_fulfillment_method_id and shop_id=p_shop_id and active;
  if shop_record.id is null or method_record.id is null then
    raise exception using errcode='P0001', message='Shop or fulfillment method is unavailable.';
  end if;

  insert into public.customers(seller_account_id,name,email,phone,country)
  values (shop_record.seller_account_id,btrim(p_buyer->>'name'),lower(p_buyer->>'email'),p_buyer->>'phone',(p_buyer->>'country')::public.country_code)
  on conflict (seller_account_id,email) do update set name=excluded.name, phone=excluded.phone
  returning id into v_customer_id;

  insert into public.customer_consents(customer_id,seller_account_id,purpose,status)
  values (v_customer_id,shop_record.seller_account_id,'marketing',
    case when coalesce((p_buyer->>'marketingConsent')::boolean,false) then 'granted'::public.consent_status else 'withdrawn'::public.consent_status end)
  on conflict (customer_id,purpose) do update set status=excluded.status,captured_at=now();

  for line in select value from jsonb_array_elements(p_lines) loop
    quantity := (line->>'quantity')::integer;
    select * into product_record from public.products
      where id=(line->>'productId')::uuid and shop_id=p_shop_id and status='active' for update;
    if product_record.id is null or quantity < 1 then
      raise exception using errcode='P0001', message='Product is unavailable.';
    end if;
    if nullif(line->>'variantId','') is not null then
      select * into variant_record from public.product_variants
        where id=(line->>'variantId')::uuid and product_id=product_record.id and active for update;
      if variant_record.id is null then raise exception using errcode='P0001', message='Variant is unavailable.'; end if;
      unit_price := coalesce(variant_record.price_minor, product_record.price_minor);
    else
      variant_record := null;
      unit_price := product_record.price_minor;
    end if;
    subtotal := subtotal + unit_price * quantity;
  end loop;

  insert into public.orders(shop_id,seller_account_id,customer_id,payment_status,currency,
    subtotal_minor,delivery_minor,total_minor,payment_method,fulfillment_method_snapshot,buyer_snapshot)
  values (p_shop_id,shop_record.seller_account_id,v_customer_id,
    case when p_payment_method='paystack' then 'unpaid'::public.payment_status else 'offline_due'::public.payment_status end,
    shop_record.currency,subtotal,method_record.fee_minor,subtotal+method_record.fee_minor,p_payment_method,
    jsonb_build_object('id',method_record.id,'type',method_record.type,'name',method_record.name,'feeMinor',method_record.fee_minor,'instructions',method_record.instructions),
    p_buyer)
  returning id into v_order_id;

  for line in select value from jsonb_array_elements(p_lines) loop
    quantity := (line->>'quantity')::integer;
    select * into product_record from public.products where id=(line->>'productId')::uuid for update;
    variant_record := null;
    if nullif(line->>'variantId','') is not null then
      select * into variant_record from public.product_variants where id=(line->>'variantId')::uuid for update;
      unit_price := coalesce(variant_record.price_minor,product_record.price_minor);
    else unit_price := product_record.price_minor; end if;

    perform public.reserve_product_stock(product_record.id,variant_record.id,quantity,
      'order:'||v_order_id::text||':'||product_record.id::text||':'||coalesce(variant_record.id::text,'base'),
      now()+interval '30 minutes');
    insert into public.order_lines(order_id,product_id,variant_id,product_name,variant_name,sku,
      unit_price_minor,quantity,line_total_minor,snapshot)
    values(v_order_id,product_record.id,variant_record.id,product_record.name,variant_record.name,
      coalesce(variant_record.sku,product_record.sku),unit_price,quantity,unit_price*quantity,
      jsonb_build_object('productName',product_record.name,'variantName',variant_record.name,'sku',coalesce(variant_record.sku,product_record.sku),'unitPriceMinor',unit_price,'currency',product_record.currency));
  end loop;

  insert into public.order_events(order_id,seller_account_id,event_type,actor_type,data)
  values(v_order_id,shop_record.seller_account_id,'order_placed','system',jsonb_build_object('paymentMethod',p_payment_method));
  select jsonb_build_object('orderId',id,'reference',public_reference,'trackingToken',tracking_token,
    'paymentStatus',payment_status,'totalMinor',total_minor,'currency',currency)
  into result from public.orders where id=v_order_id;
  insert into public.idempotency_keys(scope,key,response) values('guest_order',p_idempotency_key,result);
  return result;
exception when unique_violation then
  select response into existing from public.idempotency_keys where scope='guest_order' and key=p_idempotency_key;
  if existing is not null then return existing; end if;
  raise;
end; $$;

alter table public.customers enable row level security; alter table public.customers force row level security;
alter table public.customer_consents enable row level security; alter table public.customer_consents force row level security;
alter table public.orders enable row level security; alter table public.orders force row level security;
alter table public.order_lines enable row level security; alter table public.order_lines force row level security;
alter table public.order_events enable row level security; alter table public.order_events force row level security;
alter table public.idempotency_keys enable row level security; alter table public.idempotency_keys force row level security;

create policy customers_owner_operator_read on public.customers for select to authenticated using (seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()));
create policy orders_owner_operator_read on public.orders for select to authenticated using (seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()));
create policy order_lines_owner_operator_read on public.order_lines for select to authenticated using (exists(select 1 from public.orders where orders.id=order_lines.order_id and (orders.seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()))));
create policy order_events_owner_operator_read on public.order_events for select to authenticated using (seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()));
create policy consents_owner_operator_read on public.customer_consents for select to authenticated using (seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()));

grant select on public.customers,public.customer_consents,public.orders,public.order_lines,public.order_events to authenticated;
grant execute on function public.create_guest_order(uuid,uuid,jsonb,jsonb,text,text) to anon,authenticated,service_role;
grant all on public.customers,public.customer_consents,public.orders,public.order_lines,public.order_events,public.idempotency_keys to service_role;
