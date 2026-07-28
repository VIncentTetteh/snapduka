-- Join the conversion to the click that produced it.
--
-- Before this, a sale inserted a SECOND campaign_attributions row with a null
-- session_key, so "clicks" and "orders" were unrelated rows that were never
-- joined — which is also why Share Studio double-counted every conversion as a
-- click. A commission that cannot be traced to a real click is not auditable.
--
-- p_click_id is added LAST and defaulted so the currently-deployed app, which
-- calls with eight named arguments, keeps resolving while the migration is
-- ahead of the deploy. Dropping first avoids leaving two arities visible to
-- PostgREST at once (PGRST203 overload ambiguity).

drop function public.create_guest_order_growth(uuid, uuid, jsonb, jsonb, text, text, text, text);

create function public.create_guest_order_growth(
  p_shop_id uuid, p_fulfillment_method_id uuid, p_buyer jsonb, p_lines jsonb,
  p_idempotency_key text, p_payment_method text, p_promotion_code text default null,
  p_campaign_token text default null, p_click_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare
  result jsonb;
  order_record public.orders%rowtype;
  promotion_record public.promotions%rowtype;
  campaign_record public.campaign_links%rowtype;
  discount_value bigint := 0;
  matched_click uuid;
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
      update public.orders set campaign_snapshot=jsonb_build_object(
        'id',campaign_record.id,'name',campaign_record.name,'token',campaign_record.token,
        'channel',campaign_record.channel,'clickId',p_click_id) where id=order_record.id;

      -- Preferred path: convert the caller's own click row in place, so one
      -- row tells the whole story. Scoped to this campaign, still open, and
      -- inside the 30-day attribution window that the cookie also enforces.
      if p_click_id is not null then
        update public.campaign_attributions
          set order_id=order_record.id, converted_at=now(), last_seen_at=now()
          where id=p_click_id and campaign_id=campaign_record.id and order_id is null
            and first_seen_at > now() - interval '30 days'
          returning id into matched_click;
      end if;

      -- Fallback for cookie-blocked browsers and in-app webviews that drop the
      -- cookie on the redirect: record the conversion without a click, marked
      -- so reporting can tell the two apart.
      if matched_click is null then
        insert into public.campaign_attributions(campaign_id,seller_account_id,order_id,converted_at,source)
          values(campaign_record.id,order_record.seller_account_id,order_record.id,now(),'fallback')
          on conflict(order_id) do nothing;
      end if;
    end if;
  end if;
  select jsonb_build_object('orderId',id,'reference',public_reference,'trackingToken',tracking_token,'paymentStatus',payment_status,'totalMinor',total_minor,'discountMinor',discount_minor,'currency',currency)
    into result from public.orders where id=order_record.id;
  update public.idempotency_keys set response=result where scope='guest_order' and key=p_idempotency_key;
  return result;
end; $$;

grant execute on function public.create_guest_order_growth(uuid,uuid,jsonb,jsonb,text,text,text,text,uuid) to anon,authenticated,service_role;
