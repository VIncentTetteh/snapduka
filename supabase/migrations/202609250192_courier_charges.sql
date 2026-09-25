-- Charging the seller for a delivery SnapDuka booked on its own courier account.
--
-- When a seller has not connected their own courier account, an adapter
-- booking goes through SnapDuka's platform account and the courier bills
-- SnapDuka. Without these entries that cost landed nowhere: the buyer's
-- delivery fee had already gone to the seller in their settlement, and
-- SnapDuka paid the courier out of its own pocket.
--
-- The charge comes out of the order's held settlement (seller_pending), in the
-- same ledger, before release — so it can only be taken while it is still
-- held, and the settlement's pending_minor shrinks with it (otherwise the
-- release would try to move more than seller_pending holds and fail).

alter table public.order_settlements
  add column courier_charge_minor bigint not null default 0 check (courier_charge_minor >= 0);

alter table public.shipments
  add column courier_cost_minor bigint check (courier_cost_minor >= 0),
  add column delivery_margin_minor bigint check (delivery_margin_minor >= 0),
  add column charged_at timestamptz;

/**
 * Whether SnapDuka can recover a platform-account booking of about p_estimate
 * from this order: captured on the ledger, still held, not frozen, and with
 * enough pending to cover it. Used to refuse the booking up front, rather
 * than booking and discovering the money is not there.
 */
create or replace function public.courier_booking_billable(p_order_id uuid, p_estimate_minor bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.order_settlements st
     where st.order_id = p_order_id
       and st.status = 'pending'
       and st.frozen_at is null
       and st.pending_minor >= greatest(coalesce(p_estimate_minor, 0), 0)
  );
$$;

/**
 * Books the courier cost plus SnapDuka's margin against the order's held
 * settlement. Idempotent per shipment. Returns the total charged, or null when
 * the order can no longer cover it (the caller logs it for operators; the
 * booking itself already happened).
 */
create or replace function public.charge_courier_booking(p_shipment_id uuid, p_cost_minor bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  sh public.shipments%rowtype;
  st public.order_settlements%rowtype;
  v_margin_bps integer;
  v_margin bigint;
  v_total bigint;
begin
  if p_cost_minor is null or p_cost_minor < 0 then
    raise exception using errcode = '22023', message = 'Courier cost must be zero or more.';
  end if;

  select * into sh from public.shipments where id = p_shipment_id for update;
  if sh.id is null then return null; end if;
  if sh.charged_at is not null then return sh.courier_cost_minor + sh.delivery_margin_minor; end if;

  select * into st from public.order_settlements where order_id = sh.order_id for update;
  select cc.delivery_margin_bps into v_margin_bps
    from public.seller_accounts sa join public.country_configs cc on cc.country = sa.country
   where sa.id = sh.seller_account_id;

  v_margin := (p_cost_minor * coalesce(v_margin_bps, 0)) / 10000;
  v_total := p_cost_minor + v_margin;

  if st.id is null or st.status <> 'pending' or st.pending_minor < v_total then
    perform public.emit_domain_event('order', sh.order_id, 'courier.charge_unrecovered',
      jsonb_build_object('orderId', sh.order_id, 'shipmentId', sh.id, 'costMinor', p_cost_minor),
      'courier.charge_unrecovered:' || sh.id::text);
    return null;
  end if;

  perform public.post_ledger_transaction(
    'courier_charge', 'courier_charge:' || sh.id::text, st.currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'seller_pending', 'seller_account_id', sh.seller_account_id, 'amount_minor', v_total),
      jsonb_build_object('kind', 'courier_payable', 'amount_minor', -p_cost_minor),
      jsonb_build_object('kind', 'delivery_margin_revenue', 'amount_minor', -v_margin)),
    sh.seller_account_id, sh.order_id, null, null, 'Courier booked through SnapDuka',
    jsonb_build_object('shipmentId', sh.id, 'provider', sh.provider));

  update public.order_settlements
     set pending_minor = pending_minor - v_total,
         courier_charge_minor = courier_charge_minor + v_total
   where id = st.id;

  update public.shipments
     set courier_cost_minor = p_cost_minor, delivery_margin_minor = v_margin, charged_at = now()
   where id = sh.id;

  return v_total;
end;
$$;

/** Operator records paying a courier's invoice: the payable is cleared from the bank. */
create or replace function public.settle_courier_payable(
  p_currency public.currency_code,
  p_amount_minor bigint,
  p_reference text,
  p_operator_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_owed bigint;
begin
  if p_amount_minor is null or p_amount_minor <= 0 or p_reference is null or btrim(p_reference) = '' then
    raise exception using errcode = '22023', message = 'Enter the amount paid and the courier invoice reference.';
  end if;
  select coalesce(sum(balance_minor), 0) into v_owed from public.ledger_accounts
   where kind = 'courier_payable' and currency = p_currency;
  if p_amount_minor > v_owed then
    raise exception using errcode = '55000',
      message = format('SnapDuka owes couriers %s; cannot settle %s.', v_owed, p_amount_minor);
  end if;
  return public.post_ledger_transaction(
    'courier_settlement', 'courier_settlement:' || p_reference, p_currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'courier_payable', 'amount_minor', p_amount_minor),
      jsonb_build_object('kind', 'bank_settlement', 'amount_minor', -p_amount_minor)),
    null, null, null, null, 'Courier invoice paid',
    jsonb_build_object('reference', p_reference, 'operatorUserId', p_operator_user_id));
end;
$$;

revoke all on function public.courier_booking_billable(uuid, bigint) from public, anon, authenticated;
revoke all on function public.charge_courier_booking(uuid, bigint) from public, anon, authenticated;
revoke all on function public.settle_courier_payable(public.currency_code, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.courier_booking_billable(uuid, bigint) to service_role;
grant execute on function public.charge_courier_booking(uuid, bigint) to service_role;
grant execute on function public.settle_courier_payable(public.currency_code, bigint, text, uuid) to service_role;
