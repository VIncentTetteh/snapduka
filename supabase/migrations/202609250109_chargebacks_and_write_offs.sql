-- Card chargebacks (Paystack charge.dispute.*) and operator write-offs.
--
-- The Paystack webhook acknowledged charge.dispute.* and did nothing. Under
-- ledger settlement that is a direct loss: Paystack takes a lost chargeback out
-- of SnapDuka's balance while the seller keeps the money in their wallet — or
-- has already withdrawn it.
--
-- Accounting, following apply_refund_to_ledger:
--   * On create, the settlement is frozen. If the seller's share has already
--     been released, that share moves from seller_available into the seller's
--     own seller_dispute_reserve so it cannot be withdrawn (available may go
--     negative — a real debt, which blocks withdrawals).
--   * Won: the reserve goes back to available; the settlement unfreezes.
--   * Lost: Paystack's debit is booked against the reserve (released case) or
--     pending (unreleased case), with SnapDuka giving back its fee pro-rata out
--     of platform_revenue — the same fairness rule as refunds.
--   Shares are pro-rata to the settlement's own split snapshot, so the Protect
--   fee (SnapDuka's) is borne by SnapDuka, not the seller.
--
-- Paystack payload assumptions (verify against a live sandbox dispute before
-- enabling in production — documented in docs/runbooks/payments.md):
--   data.id                      dispute id
--   data.transaction.reference   our payment reference
--   data.refund_amount           disputed amount in minor units (falls back to
--                                data.transaction.amount)
--   data.status / data.resolution  a resolution of 'declined' means the
--                                merchant won; any other resolution is treated
--                                as lost (conservative: reserve, never release).

create table public.payment_disputes (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paystack',
  provider_dispute_id text not null,
  order_id uuid not null references public.orders (id) on delete restrict,
  seller_account_id uuid not null references public.seller_accounts (id) on delete restrict,
  currency public.currency_code not null,
  amount_minor bigint not null check (amount_minor > 0),
  -- Seller's share computed at creation from the settlement snapshot.
  seller_share_minor bigint not null default 0 check (seller_share_minor >= 0),
  -- 'pending' = settlement still held; 'available' = moved to the reserve.
  reserved_from text check (reserved_from in ('pending', 'available')),
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  provider_status text,
  due_by timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_disputes_provider_key unique (provider, provider_dispute_id)
);

create index payment_disputes_order_idx on public.payment_disputes (order_id);
create index payment_disputes_open_idx on public.payment_disputes (due_by) where status = 'open';

create trigger payment_disputes_set_updated_at
  before update on public.payment_disputes
  for each row execute function public.set_updated_at();

alter table public.payment_disputes enable row level security;
alter table public.payment_disputes force row level security;
create policy payment_disputes_owner_operator_read on public.payment_disputes
for select to authenticated using (
  seller_account_id = (select public.current_seller_account_id())
  or (select public.is_operator())
);
grant select on public.payment_disputes to authenticated;
revoke insert, update, delete on public.payment_disputes from anon, authenticated;
grant all on public.payment_disputes to service_role;

create or replace function public.apply_paystack_dispute_event(
  p_event_key text,
  p_event text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_reference text := p_payload #>> '{data,transaction,reference}';
  v_dispute_id text := p_payload #>> '{data,id}';
  v_amount bigint;
  v_resolution text := lower(coalesce(p_payload #>> '{data,resolution}', ''));
  v_due timestamptz;
  attempt public.payment_attempts%rowtype;
  st public.order_settlements%rowtype;
  d public.payment_disputes%rowtype;
  v_seller_share bigint;
  v_platform_share bigint;
  v_from text;
begin
  insert into public.provider_events (provider, event_key, event_type, payload)
  values ('paystack', p_event_key, p_event, p_payload)
  on conflict (provider, event_key) do nothing;
  if not found then return 'duplicate'; end if;

  select * into attempt from public.payment_attempts where reference = v_reference;
  if attempt.id is null or v_dispute_id is null then
    update public.provider_events set processed_at = now()
     where provider = 'paystack' and event_key = p_event_key;
    return 'unmatched';
  end if;

  v_amount := coalesce(nullif(p_payload #>> '{data,refund_amount}', '')::bigint,
                       nullif(p_payload #>> '{data,transaction,amount}', '')::bigint);
  v_due := nullif(p_payload #>> '{data,due_at}', '')::timestamptz;

  select * into d from public.payment_disputes
   where provider = 'paystack' and provider_dispute_id = v_dispute_id for update;

  if d.id is null then
    select * into st from public.order_settlements where order_id = attempt.order_id for update;

    -- Seller share pro-rata to the settlement's own split; no settlement means a
    -- legacy split payment, where the chargeback is between Paystack and the
    -- seller's subaccount and SnapDuka only records it.
    if st.id is not null and v_amount is not null and v_amount > 0 then
      v_seller_share := least((v_amount * st.seller_gross_minor) / st.gross_minor, st.seller_gross_minor);
      -- Still held: can only take what is still pending (earlier partial
      -- refunds may have clawed some back), or seller_pending would go negative
      -- and this webhook would fail on every retry.
      if st.status <> 'released' then
        v_seller_share := least(v_seller_share, st.pending_minor);
      end if;
    else
      v_seller_share := 0;
    end if;

    v_from := case
      when st.id is null or v_seller_share = 0 then null
      when st.status = 'released' then 'available'
      else 'pending' end;

    insert into public.payment_disputes (
      provider_dispute_id, order_id, seller_account_id, currency, amount_minor,
      seller_share_minor, reserved_from, provider_status, due_by, raw)
    values (
      v_dispute_id, attempt.order_id, attempt.seller_account_id, attempt.currency,
      coalesce(nullif(v_amount, 0), attempt.amount_minor),
      v_seller_share, v_from, p_payload #>> '{data,status}', v_due, p_payload -> 'data')
    returning * into d;

    if st.id is not null then
      update public.order_settlements
         set frozen_at = now(), frozen_reason = 'chargeback'
       where id = st.id;
    end if;

    if v_from = 'available' then
      perform public.post_ledger_transaction(
        'chargeback_reserve', 'chargeback_reserve:' || d.id::text, d.currency,
        jsonb_build_array(
          jsonb_build_object('kind', 'seller_available', 'seller_account_id', d.seller_account_id,
                             'amount_minor', v_seller_share),
          jsonb_build_object('kind', 'seller_dispute_reserve', 'seller_account_id', d.seller_account_id,
                             'amount_minor', -v_seller_share)),
        d.seller_account_id, d.order_id, null, null, 'Card chargeback opened: funds reserved');
      update public.ledger_accounts
         set status = case when balance_minor < 0 then 'in_arrears' else status end
       where owner_seller_account_id = d.seller_account_id
         and kind = 'seller_available' and currency = d.currency;
    end if;

    update public.orders
       set dispute_status = case when dispute_status = 'none' then 'opened' else dispute_status end
     where id = d.order_id;

    perform public.emit_domain_event('order', d.order_id, 'chargeback.opened',
      jsonb_build_object('orderId', d.order_id, 'disputeId', d.id, 'sellerAccountId', d.seller_account_id,
                         'amountMinor', d.amount_minor, 'currency', d.currency, 'dueBy', v_due),
      'chargeback.opened:' || d.id::text);
  else
    update public.payment_disputes
       set provider_status = p_payload #>> '{data,status}',
           due_by = coalesce(v_due, due_by),
           raw = p_payload -> 'data'
     where id = d.id;
  end if;

  if p_event = 'charge.dispute.resolve' and d.status = 'open' then
    select * into st from public.order_settlements where order_id = d.order_id for update;

    if v_resolution = 'declined' then
      update public.payment_disputes set status = 'won' where id = d.id;
      if d.reserved_from = 'available' then
        perform public.post_ledger_transaction(
          'chargeback_reserve_release', 'chargeback_won:' || d.id::text, d.currency,
          jsonb_build_array(
            jsonb_build_object('kind', 'seller_dispute_reserve', 'seller_account_id', d.seller_account_id,
                               'amount_minor', d.seller_share_minor),
            jsonb_build_object('kind', 'seller_available', 'seller_account_id', d.seller_account_id,
                               'amount_minor', -d.seller_share_minor)),
          d.seller_account_id, d.order_id, null, null, 'Card chargeback won: funds returned');
      end if;
      if st.id is not null and st.frozen_reason = 'chargeback' then
        update public.order_settlements set frozen_at = null, frozen_reason = null where id = st.id;
      end if;
    else
      update public.payment_disputes set status = 'lost' where id = d.id;
      v_platform_share := d.amount_minor - d.seller_share_minor;
      if d.reserved_from is not null then
        perform public.post_ledger_transaction(
          'chargeback_lost', 'chargeback_lost:' || d.id::text, d.currency,
          jsonb_build_array(
            jsonb_build_object('kind',
                               case d.reserved_from when 'available' then 'seller_dispute_reserve'
                                                    else 'seller_pending' end,
                               'seller_account_id', d.seller_account_id,
                               'amount_minor', d.seller_share_minor),
            jsonb_build_object('kind', 'platform_revenue', 'amount_minor', v_platform_share),
            jsonb_build_object('kind', 'processor_clearing', 'amount_minor', -d.amount_minor)),
          d.seller_account_id, d.order_id, null, null, 'Card chargeback lost');
        if d.reserved_from = 'pending' then
          update public.order_settlements
             set pending_minor = pending_minor - d.seller_share_minor,
                 clawed_back_minor = clawed_back_minor + d.seller_share_minor,
                 status = case when pending_minor - d.seller_share_minor = 0 then 'reversed' else status end
           where id = st.id;
        end if;
      end if;
      -- The remainder of a partially charged-back order stays frozen for an
      -- operator to release deliberately.
      update public.orders
         set payment_status = case
               when d.amount_minor >= total_minor then 'refunded'::public.payment_status
               else 'partially_refunded'::public.payment_status end
       where id = d.order_id;
    end if;

    update public.orders set dispute_status = 'resolved' where id = d.order_id;
    perform public.emit_domain_event('order', d.order_id, 'chargeback.resolved',
      jsonb_build_object('orderId', d.order_id, 'disputeId', d.id, 'sellerAccountId', d.seller_account_id,
                         'won', v_resolution = 'declined'),
      'chargeback.resolved:' || d.id::text);
  end if;

  update public.provider_events set processed_at = now()
   where provider = 'paystack' and event_key = p_event_key;
  return 'applied';
end;
$$;

revoke all on function public.apply_paystack_dispute_event(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_paystack_dispute_event(text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Write-offs
-- ---------------------------------------------------------------------------

/**
 * Forgives some or all of a seller's negative available balance: the loss moves
 * to SnapDuka's bad_debt expense. The bad_debt account existed since
 * 202607310058 with nothing able to write to it, so the only way to clear an
 * uncollectable debt was to leave the seller blocked forever.
 *
 * Operator-only (service role behind an operator check). Idempotent on the
 * caller's key. Never forgives more than is owed.
 */
create or replace function public.write_off_seller_debt(
  p_seller_account_id uuid,
  p_currency public.currency_code,
  p_amount_minor bigint,
  p_reason text,
  p_operator_user_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_account uuid;
  v_balance bigint;
  v_txn uuid;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception using errcode = '22023', message = 'Write-off amount must be positive.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'Record why the debt is being written off.';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'An idempotency key is required.';
  end if;

  v_account := public.ledger_account_for('seller_available', p_currency, p_seller_account_id);
  select balance_minor into v_balance from public.ledger_accounts where id = v_account for update;

  if exists (select 1 from public.ledger_transactions
              where event_key = 'write_off:' || p_idempotency_key) then
    return (select id from public.ledger_transactions where event_key = 'write_off:' || p_idempotency_key);
  end if;
  if v_balance >= 0 or p_amount_minor > -v_balance then
    raise exception using errcode = '55000',
      message = format('The seller owes %s; cannot write off %s.', greatest(-v_balance, 0), p_amount_minor);
  end if;

  v_txn := public.post_ledger_transaction(
    'write_off', 'write_off:' || p_idempotency_key, p_currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'bad_debt', 'amount_minor', p_amount_minor),
      jsonb_build_object('kind', 'seller_available', 'seller_account_id', p_seller_account_id,
                         'amount_minor', -p_amount_minor)),
    p_seller_account_id, null, null, null, p_reason,
    jsonb_build_object('operatorUserId', p_operator_user_id));

  update public.ledger_accounts
     set status = case when balance_minor < 0 then 'in_arrears' else 'open' end
   where id = v_account;

  return v_txn;
end;
$$;

revoke all on function public.write_off_seller_debt(uuid, public.currency_code, bigint, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.write_off_seller_debt(uuid, public.currency_code, bigint, text, uuid, text)
  to service_role;
