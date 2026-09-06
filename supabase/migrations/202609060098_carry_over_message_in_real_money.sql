-- Say the carry-over shortfall in money, not in minor units.
--
-- 202609060097 added the refusal that fires when a creator's outstanding refunds
-- exceed the commissions the seller selected, and it interpolated `abs(v_net)`
-- straight into the message. `markCommissionsPaid` passes `error.message` through
-- to the seller unchanged (dashboard/creators/actions.ts), so a GH₵ 73.20
-- shortfall reached them as "7320 of refunds are still to be recovered" — a
-- hundred-fold overstatement, on the one screen where the number is the point.
--
-- Decimals come from the same place the clients read them,
-- `country_configs.address_config->>'currencyDecimals'`: absent for GHS and NGN,
-- and 0 for XOF, which has no minor unit at all.

create or replace function public.record_creator_commission_payment(
  p_creator_id uuid,
  p_commission_ids uuid[],
  p_method text,
  p_external_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_seller uuid;
  v_gross bigint;
  v_adjustments bigint;
  v_net bigint;
  v_currency public.currency_code;
  v_decimals integer;
  v_shortfall text;
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

  select count(*), coalesce(sum(c.amount_minor), 0), count(distinct c.currency)
    into v_eligible, v_gross, v_currency_count
  from public.creator_commissions c
  where c.id = any(p_commission_ids)
    and c.seller_account_id = v_seller
    and c.creator_id = p_creator_id
    and c.status = 'payable';

  -- All-or-nothing: anything not owned by this seller, not for this creator, or
  -- no longer payable fails to match and aborts rather than quietly paying the
  -- subset that did.
  if v_eligible <> array_length(p_commission_ids, 1) then
    raise exception using errcode = 'P0001',
      message = 'Some commissions are no longer payable. Refresh and try again.';
  end if;
  if v_gross <= 0 then
    raise exception using errcode = 'P0001', message = 'Nothing to pay.';
  end if;
  if v_currency_count > 1 then
    raise exception using errcode = 'P0001', message = 'Commissions must share one currency.';
  end if;

  select c.currency into v_currency from public.creator_commissions c
   where c.id = any(p_commission_ids) limit 1;

  -- Outstanding carry-over in the same currency. Negative, so it reduces the
  -- payment. Currencies are never mixed here for the same reason the commissions
  -- are not: a creator can hold balances in GHS and NGN at once.
  select coalesce(sum(a.delta_minor), 0)
    into v_adjustments
  from public.creator_commission_adjustments a
  where a.creator_id = p_creator_id
    and a.seller_account_id = v_seller
    and a.currency = v_currency
    and a.settled_by_payment_id is null;

  v_net := v_gross + v_adjustments;

  -- A debt larger than the selection means nothing is owed yet, which is exactly
  -- what owed_now already displays as zero. Refusing is the honest outcome:
  -- creator_commission_payments requires amount_minor > 0, so there is no such
  -- thing as a zero payment to record, and marking commissions paid without one
  -- would tell the creator money moved when none did.
  if v_net <= 0 then
    select coalesce((cc.address_config->>'currencyDecimals')::integer, 2)
      into v_decimals
    from public.country_configs cc
    where cc.currency = v_currency
    limit 1;

    v_shortfall := case
      when coalesce(v_decimals, 2) = 0 then abs(v_net)::text
      else to_char(abs(v_net) / 100.0, 'FM999999999990.00')
    end;

    raise exception using errcode = 'P0001',
      message = format(
        'This creator owes back more than the commissions you selected are worth, so nothing is due yet. %s %s of refunds has to be recovered first.',
        v_currency, v_shortfall);
  end if;

  insert into public.creator_commission_payments
    (seller_account_id, creator_id, amount_minor, currency, method, external_reference, note, marked_by)
  values (v_seller, p_creator_id, v_net, v_currency, p_method, p_external_reference, p_note, (select auth.uid()))
  returning id, reference into v_payment_id, v_payment_reference;

  update public.creator_commissions c
    set status = 'paid', paid_at = now(), payment_id = v_payment_id, updated_at = now()
    where c.id = any(p_commission_ids) and c.seller_account_id = v_seller and c.status = 'payable';

  -- v_net > 0 means the whole outstanding debt fitted inside this payment, so
  -- every adjustment is fully absorbed and none needs splitting.
  update public.creator_commission_adjustments a
    set settled_by_payment_id = v_payment_id
    where a.creator_id = p_creator_id
      and a.seller_account_id = v_seller
      and a.currency = v_currency
      and a.settled_by_payment_id is null;

  return jsonb_build_object(
    'paymentId', v_payment_id,
    'reference', v_payment_reference,
    'amountMinor', v_net,
    'grossMinor', v_gross,
    'adjustmentMinor', v_adjustments,
    'currency', v_currency,
    'count', v_eligible);
end;
$$;
