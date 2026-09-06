-- Actually net a creator's carry-over off the next payment.
--
-- When a commission that was already paid is later refunded,
-- `reverse_creator_commission` cannot claw the money back, so it books a
-- negative row in `creator_commission_adjustments` instead. Both balance
-- readers subtract it: `creator_commission_balances` returns
-- `owed_now = greatest(0, payable + adjustments)` and the partnership page shows
-- a banner saying the amount is "netted off the next payment rather than
-- requested back".
--
-- Nothing netted it off. `record_creator_commission_payment` summed
-- `amount_minor` over the selected payable commissions and never looked at
-- adjustments at all, so the seller paid the full gross every time while the
-- debt sat there permanently depressing `owed_now`. The banner described
-- behaviour the code did not have.
--
-- Two things were missing: somewhere to record that an adjustment has been
-- accounted for, and the arithmetic itself.

alter table public.creator_commission_adjustments
  add column settled_by_payment_id uuid
    references public.creator_commission_payments (id) on delete set null;

comment on column public.creator_commission_adjustments.settled_by_payment_id is
  'The payment that absorbed this adjustment. Null means still outstanding and still reducing what is owed.';

-- The balance readers and the payment path both filter on "still outstanding".
create index if not exists creator_adjustments_outstanding_idx
  on public.creator_commission_adjustments (creator_id, seller_account_id, currency)
  where settled_by_payment_id is null;

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
    raise exception using errcode = 'P0001',
      message = format(
        'This creator owes back more than the selected commissions are worth, so nothing is due yet. %s of refunds are still to be recovered.',
        abs(v_net)::text);
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
    -- What was actually paid, after netting. `grossMinor` and `adjustmentMinor`
    -- are returned so the seller can be shown why the two differ.
    'amountMinor', v_net,
    'grossMinor', v_gross,
    'adjustmentMinor', v_adjustments,
    'currency', v_currency,
    'count', v_eligible);
end;
$$;

-- Both balance readers must agree with the payment path about what is
-- outstanding, or the list page's "Ready to pay" and the detail page's
-- "Owed now" drift apart for exactly the creator who has a carry-over.
create or replace function public.creator_commission_balances(p_creator_id uuid)
returns table (
  currency public.currency_code,
  pending_minor bigint,
  payable_minor bigint,
  paid_minor bigint,
  reversed_minor bigint,
  owed_now_minor bigint,
  carry_over_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with commissions as (
    select c.currency,
           coalesce(sum(c.amount_minor) filter (where c.status = 'pending'), 0)::bigint  as pending_minor,
           coalesce(sum(c.amount_minor) filter (where c.status = 'payable'), 0)::bigint  as payable_minor,
           coalesce(sum(c.amount_minor) filter (where c.status = 'paid'), 0)::bigint     as paid_minor,
           coalesce(sum(c.amount_minor) filter (where c.status = 'reversed'), 0)::bigint as reversed_minor
    from public.creator_commissions c
    where c.creator_id = p_creator_id
    group by c.currency
  ),
  adjustments as (
    select a.currency, coalesce(sum(a.delta_minor), 0)::bigint as delta_minor
    from public.creator_commission_adjustments a
    where a.creator_id = p_creator_id
      and a.settled_by_payment_id is null
    group by a.currency
  ),
  currencies as (
    select currency from commissions
    union
    select currency from adjustments
  )
  select
    cur.currency,
    coalesce(c.pending_minor, 0),
    coalesce(c.payable_minor, 0),
    coalesce(c.paid_minor, 0),
    coalesce(c.reversed_minor, 0),
    greatest(0, coalesce(c.payable_minor, 0) + coalesce(a.delta_minor, 0)),
    least(0, coalesce(c.payable_minor, 0) + coalesce(a.delta_minor, 0))
  from currencies cur
  left join commissions c on c.currency = cur.currency
  left join adjustments a on a.currency = cur.currency;
$$;

-- The seller's list page summed raw payable and never saw adjustments at all,
-- so "Ready to pay" could exceed what the detail page said was owed. Adding
-- owed_now_minor changes the return type, which create-or-replace cannot do, so
-- this is a drop and recreate inside the migration's transaction.
drop function if exists public.seller_creator_commission_totals();

create function public.seller_creator_commission_totals()
returns table (
  creator_id uuid,
  currency public.currency_code,
  pending_minor bigint,
  payable_minor bigint,
  paid_minor bigint,
  reversed_minor bigint,
  owed_now_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with commissions as (
    select c.creator_id, c.currency,
           coalesce(sum(c.amount_minor) filter (where c.status = 'pending'), 0)::bigint  as pending_minor,
           coalesce(sum(c.amount_minor) filter (where c.status = 'payable'), 0)::bigint  as payable_minor,
           coalesce(sum(c.amount_minor) filter (where c.status = 'paid'), 0)::bigint     as paid_minor,
           coalesce(sum(c.amount_minor) filter (where c.status = 'reversed'), 0)::bigint as reversed_minor
    from public.creator_commissions c
    group by c.creator_id, c.currency
  ),
  adjustments as (
    select a.creator_id, a.currency, coalesce(sum(a.delta_minor), 0)::bigint as delta_minor
    from public.creator_commission_adjustments a
    where a.settled_by_payment_id is null
    group by a.creator_id, a.currency
  )
  select
    c.creator_id,
    c.currency,
    c.pending_minor,
    c.payable_minor,
    c.paid_minor,
    c.reversed_minor,
    greatest(0, c.payable_minor + coalesce(a.delta_minor, 0))
  from commissions c
  left join adjustments a on a.creator_id = c.creator_id and a.currency = c.currency;
$$;

grant execute on function public.seller_creator_commission_totals() to authenticated, service_role;

-- Platform operators could already read every commission
-- (`creator_commissions_operator_read`) but no adjustment, so an operator
-- inspecting a disputed balance saw the gross and none of the reversals that
-- explain it. Read-only, and only for a role that already sees the other half.
create policy creator_adjustments_operator_read on public.creator_commission_adjustments
  as permissive for select to authenticated
  using ((select public.is_operator()));
