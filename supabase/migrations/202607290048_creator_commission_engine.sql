-- Creator commission engine: accrual, reversal, hold release, settlement.
--
-- Accrual hangs off orders.payment_status rather than the checkout RPC on
-- purpose. payment_method includes cash_on_delivery, pay_on_pickup and
-- seller_arranged, none of which touch the Paystack webhook — accruing inside
-- create_guest_order_growth would silently skip every offline sale, which in
-- Ghana and Nigeria is a large share of them. One trigger on the column that
-- actually changes catches every route.

-- ---------------------------------------------------------------------------
-- Accrual
-- ---------------------------------------------------------------------------

create function public.accrue_creator_commission() returns trigger
language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  link public.campaign_links%rowtype;
  partnership public.creator_partnerships%rowtype;
  basis bigint;
  shop_name text;
begin
  -- Only the unpaid -> paid edge. `is not distinct from` so a null old value
  -- still counts as a transition.
  if new.payment_status <> 'paid' or old.payment_status is not distinct from 'paid' then
    return new;
  end if;
  if new.campaign_snapshot is null then return new; end if;

  select * into link from public.campaign_links
   where id = (new.campaign_snapshot->>'id')::uuid;
  if link.id is null or link.creator_partnership_id is null then return new; end if;

  -- Only an accepted, live partnership earns. A paused or ended one keeps its
  -- historical commissions but accrues nothing new.
  select * into partnership from public.creator_partnerships
   where id = link.creator_partnership_id and status = 'active';
  if partnership.id is null then return new; end if;

  -- Goods sold after discount. Delivery is a pass-through cost, not margin.
  basis := greatest(new.subtotal_minor - new.discount_minor, 0);
  select display_name into shop_name from public.shops where id = new.shop_id;

  insert into public.creator_commissions (
    seller_account_id, creator_id, partnership_id, order_id, campaign_id,
    attribution_id, currency, basis_minor, rate_bps, amount_minor, hold_days,
    order_reference, order_placed_at, shop_display_name, payable_at
  ) values (
    new.seller_account_id, partnership.creator_id, partnership.id, new.id, link.id,
    (select id from public.campaign_attributions where order_id = new.id limit 1),
    new.currency, basis, partnership.rate_bps,
    floor(basis::numeric * partnership.rate_bps / 10000)::bigint,
    partnership.hold_days,
    new.public_reference, new.created_at, coalesce(shop_name, 'Shop'),
    now() + make_interval(days => partnership.hold_days)
  )
  -- Idempotent against the webhook/verify race, the same guard
  -- create_guest_order_growth already relies on.
  on conflict (order_id) do nothing;

  return new;
end; $$;

create trigger orders_accrue_creator_commission
  after update of payment_status on public.orders
  for each row execute function public.accrue_creator_commission();

-- ---------------------------------------------------------------------------
-- Reversal
-- ---------------------------------------------------------------------------

create function public.reverse_creator_commission() returns trigger
language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  commission public.creator_commissions%rowtype;
  refunded bigint;
  new_basis bigint;
  new_amount bigint;
  reason text;
begin
  select * into commission from public.creator_commissions where order_id = new.id;
  if commission.id is null then return new; end if;
  -- Already settled to zero, or voided by an operator: nothing left to do.
  if commission.status in ('reversed', 'void') then return new; end if;

  if new.status = 'cancelled' then
    reason := 'order_cancelled';
  elsif new.payment_status = 'refunded' or new.refund_status = 'completed' then
    reason := 'order_refunded';
  elsif new.refund_status = 'partial' then
    reason := 'order_partially_refunded';
  else
    return new;
  end if;

  if reason = 'order_partially_refunded' then
    select coalesce(sum(amount_minor), 0) into refunded
      from public.refunds where order_id = new.id and status = 'completed';
    if new.total_minor <= 0 or refunded <= 0 then return new; end if;
    if refunded >= new.total_minor then
      new_basis := 0;
    else
      new_basis := floor(commission.basis_minor::numeric * (new.total_minor - refunded) / new.total_minor)::bigint;
    end if;
  else
    new_basis := 0;
  end if;

  new_amount := floor(new_basis::numeric * commission.rate_bps / 10000)::bigint;
  -- Idempotency: a replayed webhook must not book the same correction twice.
  if new_amount = commission.amount_minor then return new; end if;

  if commission.status = 'paid' then
    -- Money has already left the seller's hand. The commission row is history;
    -- the difference becomes a debt against future earnings instead.
    insert into public.creator_commission_adjustments
      (commission_id, seller_account_id, creator_id, delta_minor, currency, reason)
    values (commission.id, commission.seller_account_id, commission.creator_id,
            new_amount - commission.amount_minor, commission.currency, reason);
  elsif new_basis = 0 then
    update public.creator_commissions
      set status = 'reversed', reversed_at = now(), reversal_reason = reason,
          basis_minor = 0, amount_minor = 0
      where id = commission.id;
  else
    update public.creator_commissions
      set basis_minor = new_basis, amount_minor = new_amount, reversal_reason = reason
      where id = commission.id;
  end if;

  return new;
end; $$;

create trigger orders_reverse_creator_commission
  after update of status, payment_status, refund_status on public.orders
  for each row execute function public.reverse_creator_commission();

-- ---------------------------------------------------------------------------
-- Hold release
-- ---------------------------------------------------------------------------

-- Re-checks the order at release time, not just at accrual: an order that was
-- refunded or disputed during the hold must not quietly become payable.
create function public.release_due_creator_commissions() returns integer
language plpgsql security definer set search_path = '' set row_security = off as $$
declare released integer;
begin
  update public.creator_commissions c
  set status = 'payable', updated_at = now()
  from public.orders o
  where c.order_id = o.id
    and c.status = 'pending'
    and c.payable_at <= now()
    and c.amount_minor > 0
    and o.payment_status = 'paid'
    and o.refund_status = 'none'
    and o.dispute_status = 'none'
    and o.status <> 'cancelled';
  get diagnostics released = row_count;
  return released;
end; $$;

revoke execute on function public.release_due_creator_commissions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settlement
-- ---------------------------------------------------------------------------

-- The only write path into creator_commissions for a seller. All-or-nothing:
-- any commission failing a check aborts the whole batch, so a partial payment
-- can never be recorded as a full one.
create function public.record_creator_commission_payment(
  p_creator_id uuid,
  p_commission_ids uuid[],
  p_method text,
  p_external_reference text default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' set row_security = off as $$
-- Locals are v_-prefixed: `set payment_id = payment_id` in the UPDATE below
-- would resolve to the variable on both sides, and a bare `currency` local
-- shadows the column it is selected from.
declare
  v_seller uuid;
  v_total bigint;
  v_currency public.currency_code;
  v_eligible integer;
  v_currency_count integer;
  v_payment_id uuid;
  v_payment_reference text;
begin
  v_seller := public.current_seller_account_id();
  if v_seller is null then
    raise exception using errcode = '42501', message = 'Only a seller can record a payment.';
  end if;
  if p_commission_ids is null or array_length(p_commission_ids, 1) is null then
    raise exception using errcode = 'P0001', message = 'Select at least one commission to pay.';
  end if;
  if p_method not in ('mobile_money', 'bank_transfer', 'cash', 'other') then
    raise exception using errcode = 'P0001', message = 'Unrecognised payment method.';
  end if;

  -- Anything not owned by this seller, not for this creator, or not payable
  -- simply will not match — so a count mismatch is the whole authorization
  -- check, and it fails the batch rather than paying the subset that matched.
  select count(*), coalesce(sum(c.amount_minor), 0), count(distinct c.currency)
    into v_eligible, v_total, v_currency_count
  from public.creator_commissions c
  where c.id = any(p_commission_ids)
    and c.seller_account_id = v_seller
    and c.creator_id = p_creator_id
    and c.status = 'payable';

  if v_eligible <> array_length(p_commission_ids, 1) then
    raise exception using errcode = 'P0001',
      message = 'Some commissions are no longer payable. Refresh and try again.';
  end if;
  if v_total <= 0 then
    raise exception using errcode = 'P0001', message = 'Nothing to pay.';
  end if;
  if v_currency_count > 1 then
    raise exception using errcode = 'P0001', message = 'Commissions must share one currency.';
  end if;

  select c.currency into v_currency from public.creator_commissions c
   where c.id = any(p_commission_ids) limit 1;

  insert into public.creator_commission_payments
    (seller_account_id, creator_id, amount_minor, currency, method, external_reference, note, marked_by)
  values (v_seller, p_creator_id, v_total, v_currency, p_method, p_external_reference, p_note, (select auth.uid()))
  returning id, reference into v_payment_id, v_payment_reference;

  update public.creator_commissions c
    set status = 'paid', paid_at = now(), payment_id = v_payment_id, updated_at = now()
    where c.id = any(p_commission_ids) and c.seller_account_id = v_seller and c.status = 'payable';

  return jsonb_build_object(
    'paymentId', v_payment_id, 'reference', v_payment_reference,
    'amountMinor', v_total, 'currency', v_currency, 'count', v_eligible);
end; $$;

grant execute on function public.record_creator_commission_payment(uuid, uuid[], text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Creator identity bootstrap
-- ---------------------------------------------------------------------------

-- creators has no INSERT policy by design; identity is created here so the
-- caller can never set status or another user's auth_user_id.
create function public.bootstrap_creator_account(
  p_handle text, p_display_name text, p_contact_phone text,
  p_country public.country_code, p_contact_email text default null
) returns uuid
language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  user_id uuid;
  creator_id uuid;
begin
  user_id := (select auth.uid());
  if user_id is null then
    raise exception using errcode = '42501', message = 'Sign in to create a creator profile.';
  end if;

  select id into creator_id from public.creators where auth_user_id = user_id;
  if creator_id is not null then return creator_id; end if;

  insert into public.creators (auth_user_id, handle, display_name, contact_phone, country, contact_email)
  values (user_id, lower(btrim(p_handle)), btrim(p_display_name), p_contact_phone, p_country,
          nullif(lower(btrim(coalesce(p_contact_email, ''))), ''))
  returning id into creator_id;

  return creator_id;
end; $$;

grant execute on function public.bootstrap_creator_account(text, text, text, public.country_code, text) to authenticated;
