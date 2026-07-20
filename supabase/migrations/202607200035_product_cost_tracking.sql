alter table public.products
  add column cost_minor bigint,
  add constraint products_cost_check check (cost_minor is null or cost_minor >= 0);

grant update (cost_minor) on public.products to authenticated;

alter table public.order_lines
  add column unit_cost_minor bigint;

-- Re-create create_guest_order with one extra snapshotted column. Everything
-- else in this function is unchanged from 202606120006_orders.sql — only the
-- second order_lines insert (after stock reservation) gains unit_cost_minor.
create or replace function public.create_guest_order(
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
      unit_price_minor,quantity,line_total_minor,unit_cost_minor,snapshot)
    values(v_order_id,product_record.id,variant_record.id,product_record.name,variant_record.name,
      coalesce(variant_record.sku,product_record.sku),unit_price,quantity,unit_price*quantity,
      product_record.cost_minor,
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

grant execute on function public.create_guest_order(uuid,uuid,jsonb,jsonb,text,text) to anon,authenticated,service_role;
