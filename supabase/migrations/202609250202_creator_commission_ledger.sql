-- Creator commissions paid through the ledger.
--
-- For an order SnapDuka actually captured (an order_settlements row exists),
-- the creator's cut is now carved out of the seller's settlement at capture and
-- paid to the creator's own wallet, instead of all of it going to the seller in
-- the hope they pass the creator's share on. Every other order — cash on
-- delivery, pay on pickup, a seller still on the legacy subaccount split, or a
-- seller without the `creator_ledger_payouts` flag — keeps the record-only flow
-- exactly as it was.
--
-- The path is decided ONCE per commission and written on the row
-- (creator_commissions.settlement). A trigger forbids it changing afterwards,
-- with one exception taken before any money moves (see post_creator_commission_accrual).
-- Flipping the flag or a seller's settlement mode therefore never re-routes a
-- commission that is already in flight.
--
-- The money, per order (A = commission amount):
--
--   capture   creator_accrual   seller_pending  +A (debit)   creator_pending   -A (credit)
--   release   creator_release   creator_pending +A           creator_available -A
--   refund    creator_reversal  creator_pending/available +d  seller_pending/available -d
--
-- Release rule (one rule, applied by both workers): the creator's share becomes
-- withdrawable when BOTH the order's own settlement has released AND the
-- commission's own hold (payable_at, snapshotted from the partnership) has
-- elapsed — whichever is later. The seller's settlement release is the proof
-- that the order survived its refund/dispute window with the money still here;
-- the commission hold is the term the seller and creator agreed. Honouring only
-- one would either pay the creator from money that could still be refunded, or
-- silently shorten a hold the seller set.
--
-- Refund rule: a refund or cancellation reduces the commission by exactly the
-- amount reverse_creator_commission always computed (pro-rata to what is left of
-- the order). The difference comes out of creator_pending first, then
-- creator_available — which may go negative, flagging the creator in_arrears
-- and netting off their next commission, the same semantics as a seller — and
-- goes back to the seller, into whichever of seller_pending/seller_available the
-- order's settlement currently sits in. apply_refund_to_ledger then claws the
-- buyer's refund from the seller exactly as before, so the seller bears their
-- own share of the refund and the creator bears theirs.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.creator_commissions
  add column settlement text not null default 'manual'
    check (settlement in ('manual', 'ledger')),
  -- What this commission currently holds in creator_pending. The ledger is the
  -- truth; this is the per-commission breakdown of it, and check_ledger_invariants
  -- asserts the two agree for every creator.
  add column ledger_pending_minor bigint not null default 0 check (ledger_pending_minor >= 0),
  add column ledger_released_minor bigint not null default 0 check (ledger_released_minor >= 0),
  add column ledger_clawed_back_minor bigint not null default 0 check (ledger_clawed_back_minor >= 0),
  add column ledger_accrual_txn_id uuid references public.ledger_transactions (id),
  add column ledger_released_at timestamptz,
  add constraint creator_commissions_manual_ledger_check check (
    settlement = 'ledger'
    or (ledger_pending_minor = 0 and ledger_released_minor = 0 and ledger_clawed_back_minor = 0
        and ledger_accrual_txn_id is null and ledger_released_at is null)
  );

comment on column public.creator_commissions.settlement is
  'manual = the seller pays the creator off-platform and records it (the original flow). ledger = SnapDuka carves the commission out of the order settlement and pays the creator from their wallet. Fixed for the life of the commission.';

create index creator_commissions_ledger_release_idx
  on public.creator_commissions (payable_at)
  where settlement = 'ledger' and status = 'pending';

/**
 * The path never changes mid-life. manual -> ledger is never allowed (a seller
 * may already have paid by hand); ledger -> manual only while no ledger money
 * has moved for this commission.
 */
create or replace function public.guard_creator_commission_settlement()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.settlement is distinct from old.settlement
     and (old.settlement = 'manual' or old.ledger_accrual_txn_id is not null) then
    raise exception using errcode = '55000',
      message = 'A commission''s settlement path cannot change once it is in flight.';
  end if;
  return new;
end;
$$;

create trigger creator_commissions_guard_settlement
  before update of settlement on public.creator_commissions
  for each row execute function public.guard_creator_commission_settlement();

-- How much of this order's seller share was set aside for a creator, so the
-- settlement row still explains why pending_minor is below seller_gross_minor.
alter table public.order_settlements
  add column creator_commission_minor bigint not null default 0
    check (creator_commission_minor >= 0);

-- ---------------------------------------------------------------------------
-- Accrual into the ledger
-- ---------------------------------------------------------------------------

/**
 * Moves a ledger-settled commission out of the seller's pending share into the
 * creator's pending wallet.
 *
 * Called from two places because two things must both exist first, and which
 * arrives second depends on the caller: apply_paystack_success marks the order
 * paid (firing accrue_creator_commission, which creates the commission) BEFORE
 * it calls capture_order_settlement (which creates the settlement and credits
 * seller_pending). So the accrual trigger calls this and gets NULL for "no
 * settlement yet", and capture calls it again after crediting the seller. The
 * event key and ledger_accrual_txn_id make the second call a no-op.
 *
 * If the commission cannot be carved out of the settlement — the settlement is
 * no longer pending, is in another currency, or holds less than the commission
 * (only possible with an extreme platform fee) — the commission falls back to
 * the manual path, the one exception to "the path never changes", taken before
 * any ledger money has moved for it. Raising instead would fail the buyer's
 * payment.
 */
create or replace function public.post_creator_commission_accrual(p_commission_id uuid)
returns uuid language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  c public.creator_commissions%rowtype;
  st public.order_settlements%rowtype;
  v_txn uuid;
begin
  select * into c from public.creator_commissions where id = p_commission_id for update;
  if c.id is null or c.settlement <> 'ledger' or c.ledger_accrual_txn_id is not null then
    return null;
  end if;
  -- Zero commissions (rate 0, fully discounted) have nothing to carve out, and
  -- one reversed before capture has nothing left to carve.
  if c.status <> 'pending' or c.amount_minor <= 0 then return null; end if;

  select * into st from public.order_settlements where order_id = c.order_id for update;
  if st.id is null then return null; end if;

  if st.status <> 'pending' or st.currency <> c.currency or st.pending_minor < c.amount_minor then
    update public.creator_commissions set settlement = 'manual' where id = c.id;
    perform public.emit_domain_event('creator_commission', c.id, 'creator.ledger_fallback',
      jsonb_build_object('commissionId', c.id, 'orderId', c.order_id,
                         'amountMinor', c.amount_minor, 'settlementPendingMinor', st.pending_minor,
                         'settlementStatus', st.status),
      'creator.ledger_fallback:' || c.id::text);
    return null;
  end if;

  v_txn := public.post_ledger_transaction(
    'creator_accrual',
    'creator_accrual:' || c.id::text,
    c.currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'seller_pending', 'seller_account_id', c.seller_account_id,
                         'amount_minor', c.amount_minor),
      jsonb_build_object('kind', 'creator_pending', 'creator_id', c.creator_id,
                         'amount_minor', -c.amount_minor)
    ),
    c.seller_account_id, c.order_id, null, null,
    'Creator commission set aside',
    jsonb_build_object('commissionId', c.id, 'settlementId', st.id));

  -- Only reachable if the key was posted without the row being updated, which
  -- would itself be caught by check_ledger_invariants.
  if v_txn is null then return null; end if;

  update public.order_settlements
     set pending_minor = pending_minor - c.amount_minor,
         creator_commission_minor = creator_commission_minor + c.amount_minor
   where id = st.id;

  update public.creator_commissions
     set ledger_pending_minor = c.amount_minor,
         ledger_accrual_txn_id = v_txn
   where id = c.id;

  return v_txn;
end;
$$;

-- ---------------------------------------------------------------------------
-- Release to the creator's wallet
-- ---------------------------------------------------------------------------

/**
 * Makes one ledger-settled commission withdrawable, if the release rule in the
 * header is met. Re-checks the order and the settlement at release time, like
 * every other release in this codebase: a hold exists precisely so that what
 * happened DURING it is looked at.
 *
 * On release the commission is 'paid' — from the seller's side it has been
 * paid, by SnapDuka, out of their own settlement. payment_id stays NULL: there
 * is no seller-recorded payment behind it, which is exactly how the seller
 * screens tell "paid via SnapDuka" from "recorded by you".
 */
create or replace function public.release_creator_commission(p_commission_id uuid)
returns boolean language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  c public.creator_commissions%rowtype;
  st public.order_settlements%rowtype;
  o public.orders%rowtype;
begin
  select * into c from public.creator_commissions where id = p_commission_id for update;
  if c.id is null or c.settlement <> 'ledger' or c.status <> 'pending'
     or c.ledger_pending_minor <= 0 or c.payable_at > now() then
    return false;
  end if;

  select * into st from public.order_settlements where order_id = c.order_id;
  if st.id is null or st.status <> 'released' or st.frozen_at is not null then
    return false;
  end if;

  select * into o from public.orders where id = c.order_id;
  if o.payment_status <> 'paid' or o.refund_status <> 'none' or o.status = 'cancelled' then
    return false;
  end if;

  perform public.post_ledger_transaction(
    'creator_release',
    'creator_release:' || c.id::text,
    c.currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'creator_pending', 'creator_id', c.creator_id,
                         'amount_minor', c.ledger_pending_minor),
      jsonb_build_object('kind', 'creator_available', 'creator_id', c.creator_id,
                         'amount_minor', -c.ledger_pending_minor)
    ),
    c.seller_account_id, c.order_id, null, null,
    'Creator commission hold elapsed',
    jsonb_build_object('commissionId', c.id));

  update public.creator_commissions
     set status = 'paid',
         paid_at = now(),
         ledger_released_minor = ledger_released_minor + c.ledger_pending_minor,
         ledger_pending_minor = 0,
         ledger_released_at = now()
   where id = c.id;

  -- A creator who owed from an earlier reversal is cleared automatically once
  -- a release brings them back above zero.
  update public.ledger_accounts
     set status = case when balance_minor < 0 then 'in_arrears'
                       when status = 'in_arrears' then 'open' else status end
   where owner_creator_id = c.creator_id and kind = 'creator_available' and currency = c.currency;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reversal
-- ---------------------------------------------------------------------------

/**
 * Reduces a ledger-settled commission to p_new_amount and returns the
 * difference to the seller (or, after a lost held chargeback, to SnapDuka —
 * see below). See "Refund rule" in the header.
 *
 * The event key includes the new amount, which only ever falls, so each step of
 * a sequence of partial refunds posts once and a replayed webhook posts nothing.
 */
create or replace function public.reverse_ledger_creator_commission(
  p_commission_id uuid,
  p_new_basis bigint,
  p_new_amount bigint,
  p_reason text
)
returns uuid language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  c public.creator_commissions%rowtype;
  st public.order_settlements%rowtype;
  v_delta bigint;
  v_from_pending bigint;
  v_from_available bigint;
  v_seller_kind text;
  v_lines jsonb := '[]'::jsonb;
  v_txn uuid;
begin
  select * into c from public.creator_commissions where id = p_commission_id for update;
  if c.id is null or c.settlement <> 'ledger' then return null; end if;

  v_delta := c.amount_minor - p_new_amount;
  if v_delta <= 0 then return null; end if;

  -- No ledger money moved yet (zero commission, or reversed before capture):
  -- only the row changes, exactly as on the manual path.
  if c.ledger_accrual_txn_id is null then
    if p_new_basis = 0 then
      update public.creator_commissions
         set status = 'reversed', reversed_at = now(), paid_at = null, reversal_reason = p_reason,
             basis_minor = 0, amount_minor = 0
       where id = c.id;
    else
      update public.creator_commissions
         set basis_minor = p_new_basis, amount_minor = p_new_amount, reversal_reason = p_reason
       where id = c.id;
    end if;
    return null;
  end if;

  select * into st from public.order_settlements where order_id = c.order_id for update;

  v_from_pending := least(v_delta, c.ledger_pending_minor);
  v_from_available := v_delta - v_from_pending;
  -- The money goes back where the seller's share of this order currently is,
  -- so apply_refund_to_ledger (which runs next in a refund) finds it there.
  --
  -- Except after a card chargeback LOST while the settlement was still held.
  -- apply_paystack_dispute_event caps the seller's share at what is left in
  -- seller_pending — which no longer includes the creator's cut — so SnapDuka
  -- absorbed that cut out of platform_revenue. The creator's reversed share is
  -- what should have covered it, so it goes to platform_revenue. Sending it to
  -- the seller instead would hand them, withdrawable, money SnapDuka already
  -- paid back to the card issuer. (A full chargeback is the only one that
  -- reverses a commission: it sets payment_status = 'refunded'.)
  v_seller_kind := case
    when exists (select 1 from public.payment_disputes pd
                  where pd.order_id = c.order_id and pd.status = 'lost' and pd.reserved_from = 'pending')
      then 'platform_revenue'
    when st.status = 'pending' then 'seller_pending'
    else 'seller_available' end;

  if v_from_pending > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'kind', 'creator_pending', 'creator_id', c.creator_id, 'amount_minor', v_from_pending));
  end if;
  if v_from_available > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'kind', 'creator_available', 'creator_id', c.creator_id, 'amount_minor', v_from_available));
  end if;
  v_lines := v_lines || jsonb_build_array(case
    when v_seller_kind = 'platform_revenue'
      then jsonb_build_object('kind', v_seller_kind, 'amount_minor', -v_delta)
    else jsonb_build_object('kind', v_seller_kind, 'seller_account_id', c.seller_account_id,
                            'amount_minor', -v_delta) end);

  v_txn := public.post_ledger_transaction(
    'creator_reversal',
    'creator_reversal:' || c.id::text || ':' || p_new_amount::text,
    c.currency, v_lines,
    c.seller_account_id, c.order_id, null, null,
    'Creator commission reduced: ' || p_reason,
    jsonb_build_object('commissionId', c.id, 'reason', p_reason, 'newAmountMinor', p_new_amount));

  if v_txn is null then return null; end if;

  update public.order_settlements
     set pending_minor = pending_minor + case when v_seller_kind = 'seller_pending' then v_delta else 0 end,
         creator_commission_minor = greatest(creator_commission_minor - v_delta, 0)
   where id = st.id;

  if p_new_basis = 0 then
    update public.creator_commissions
       set status = 'reversed', reversed_at = now(), paid_at = null, reversal_reason = p_reason,
           basis_minor = 0, amount_minor = 0,
           ledger_pending_minor = ledger_pending_minor - v_from_pending,
           ledger_clawed_back_minor = ledger_clawed_back_minor + v_delta
     where id = c.id;
  else
    update public.creator_commissions
       set basis_minor = p_new_basis, amount_minor = p_new_amount, reversal_reason = p_reason,
           ledger_pending_minor = ledger_pending_minor - v_from_pending,
           ledger_clawed_back_minor = ledger_clawed_back_minor + v_delta
     where id = c.id;
  end if;

  update public.ledger_accounts
     set status = case when balance_minor < 0 then 'in_arrears'
                       when status = 'in_arrears' then 'open' else status end
   where owner_creator_id = c.creator_id and kind = 'creator_available' and currency = c.currency;
  if v_seller_kind = 'seller_available' then
    update public.ledger_accounts
       set status = case when balance_minor < 0 then 'in_arrears'
                         when status = 'in_arrears' then 'open' else status end
     where owner_seller_account_id = c.seller_account_id and kind = 'seller_available'
       and currency = c.currency;
  end if;

  return v_txn;
end;
$$;

-- ---------------------------------------------------------------------------
-- The commission engine, redefined
-- ---------------------------------------------------------------------------

/**
 * 202609060100 plus the settlement decision. A commission is ledger-settled
 * when the money is SnapDuka's to split: an online (paystack) order, a seller
 * on ledger settlement, and the seller inside the `creator_ledger_payouts`
 * rollout. Anything else — cash on delivery included — is manual, unchanged.
 */
create or replace function public.accrue_creator_commission() returns trigger
language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  link public.campaign_links%rowtype;
  partnership public.creator_partnerships%rowtype;
  basis bigint;
  shop_name text;
  v_settlement text := 'manual';
  accrued public.creator_commissions%rowtype;
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

  if new.payment_method = 'paystack'
     and public.seller_settlement_mode(new.seller_account_id) = 'ledger'
     and public.evaluate_feature_flag('creator_ledger_payouts', new.seller_account_id) then
    v_settlement := 'ledger';
  end if;

  insert into public.creator_commissions (
    seller_account_id, creator_id, partnership_id, order_id, campaign_id,
    attribution_id, currency, basis_minor, rate_bps, amount_minor, hold_days,
    order_reference, order_placed_at, shop_display_name, payable_at, settlement
  ) values (
    new.seller_account_id, partnership.creator_id, partnership.id, new.id, link.id,
    (select id from public.campaign_attributions where order_id = new.id limit 1),
    new.currency, basis, partnership.rate_bps,
    floor(basis::numeric * partnership.rate_bps / 10000)::bigint,
    partnership.hold_days,
    new.public_reference, new.created_at, coalesce(shop_name, 'Shop'),
    now() + make_interval(days => partnership.hold_days),
    v_settlement
  )
  -- Idempotent against the webhook/verify race, the same guard
  -- create_guest_order_growth already relies on.
  on conflict (order_id) do nothing
  returning * into accrued;

  -- Carve the commission out now if the settlement already exists; otherwise
  -- capture_order_settlement does it a moment later in this same transaction.
  -- NOT wrapped in an exception handler: this moves money, and a failure here
  -- must fail loudly rather than leave a commission that says "ledger" with
  -- nothing behind it.
  if accrued.id is not null and accrued.settlement = 'ledger' then
    perform public.post_creator_commission_accrual(accrued.id);
  end if;

  -- Nothing inserted means this is the second half of that race, and the
  -- creator has already been told.
  if accrued.id is not null and accrued.amount_minor > 0 then
    begin
      perform public.enqueue_creator_notification(
        accrued.creator_id, accrued.seller_account_id, 'creator_commission_earned',
        accrued.shop_display_name, accrued.amount_minor, accrued.currency,
        accrued.id::text);
    exception when others then
      -- A creator missing one message is bad. Failing the buyer's payment
      -- because of it would be very much worse.
      raise warning 'could not enqueue creator_commission_earned for %: %', accrued.id, sqlerrm;
    end;
  end if;

  return new;
end; $$;

/**
 * 202607290048 plus the ledger branch. The amount arithmetic is unchanged — a
 * ledger commission is reduced by exactly what a manual one would be — only
 * where the difference goes differs: for a manual commission already paid by
 * the seller it becomes a carry-over adjustment; for a ledger one it moves back
 * out of the creator's wallet (reverse_ledger_creator_commission).
 */
create or replace function public.reverse_creator_commission() returns trigger
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

  if commission.settlement = 'ledger' then
    perform public.reverse_ledger_creator_commission(commission.id, new_basis, new_amount, reason);
    return new;
  end if;

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

/**
 * 202609060100 plus: the manual branch no longer touches ledger commissions (a
 * ledger commission must never become 'payable', or a seller could pay it by
 * hand as well), and ledger commissions whose own hold has now elapsed are
 * released to the creator's wallet — the half of the release rule that the
 * order-settlement release cannot see.
 *
 * Returns manual commissions made payable plus ledger commissions released.
 */
create or replace function public.release_due_creator_commissions() returns integer
language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  released integer := 0;
  batch record;
  r record;
begin
  for batch in
    with freed as (
      update public.creator_commissions c
      set status = 'payable', updated_at = now()
      from public.orders o
      where c.order_id = o.id
        and c.settlement = 'manual'
        and c.status = 'pending'
        and c.payable_at <= now()
        and c.amount_minor > 0
        and o.payment_status = 'paid'
        and o.refund_status = 'none'
        and o.dispute_status = 'none'
        and o.status <> 'cancelled'
      returning c.id, c.creator_id, c.seller_account_id, c.currency,
                c.amount_minor, c.shop_display_name
    )
    select
      creator_id,
      seller_account_id,
      currency,
      sum(amount_minor)::bigint as amount_minor,
      min(shop_display_name) as shop_display_name,
      count(*)::integer as freed_count,
      min(id::text) as dedupe_key
    from freed
    group by creator_id, seller_account_id, currency
  loop
    released := released + batch.freed_count;
    begin
      perform public.enqueue_creator_notification(
        batch.creator_id, batch.seller_account_id, 'creator_commission_payable',
        batch.shop_display_name, batch.amount_minor, batch.currency, batch.dedupe_key);
    exception when others then
      raise warning 'could not enqueue creator_commission_payable for %: %', batch.creator_id, sqlerrm;
    end;
  end loop;

  -- Bounded and ordered, so one run cannot hit the row cap or hold locks for
  -- long; skip locked so it never waits on a refund being applied right now.
  for r in
    select c.id
      from public.creator_commissions c
      join public.order_settlements st on st.order_id = c.order_id
     where c.settlement = 'ledger'
       and c.status = 'pending'
       and c.ledger_pending_minor > 0
       and c.payable_at <= now()
       and st.status = 'released'
       and st.frozen_at is null
     order by c.payable_at
     limit 500
     for update of c skip locked
  loop
    if public.release_creator_commission(r.id) then
      released := released + 1;
    end if;
  end loop;

  return released;
end; $$;

/**
 * 202609060098 plus: only manual commissions can be recorded as paid by the
 * seller. Ledger commissions never reach 'payable', so this is a second lock on
 * the same door — the one place a double payment would be created.
 */
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
    and c.status = 'payable'
    and c.settlement = 'manual';

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

  select coalesce(sum(a.delta_minor), 0)
    into v_adjustments
  from public.creator_commission_adjustments a
  where a.creator_id = p_creator_id
    and a.seller_account_id = v_seller
    and a.currency = v_currency
    and a.settled_by_payment_id is null;

  v_net := v_gross + v_adjustments;

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
    where c.id = any(p_commission_ids) and c.seller_account_id = v_seller
      and c.status = 'payable' and c.settlement = 'manual';

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

-- ---------------------------------------------------------------------------
-- Hooks into the order-settlement lifecycle
-- ---------------------------------------------------------------------------

/**
 * 202609250106 unchanged, plus one line after the charge is posted: carve out
 * any ledger-settled creator commission on this order (see
 * post_creator_commission_accrual for why capture is one of its two callers).
 */
create or replace function public.capture_order_settlement(
  p_order_id uuid,
  p_payment_attempt_id uuid,
  p_reference text,
  p_psp_fee_minor bigint default 0
)
returns uuid language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  o public.orders%rowtype;
  v_country public.country_code;
  v_fee_bps integer;
  v_hold_days smallint;
  v_protect boolean;
  v_protect_fee bigint;
  v_platform_fee bigint;
  v_seller_gross bigint;
  v_settlement_id uuid;
  v_psp_fee bigint := greatest(0, coalesce(p_psp_fee_minor, 0));
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null then return null; end if;

  -- Only money that actually passed through Paystack lands in our account.
  if o.payment_method <> 'paystack' then return null; end if;

  v_protect := o.protection_mode = 'protect';

  if public.seller_settlement_mode(o.seller_account_id) <> 'ledger' then
    if v_protect then
      perform public.emit_domain_event('order', o.id, 'protect.unheld',
        jsonb_build_object('orderId', o.id, 'reason', 'seller_not_on_ledger'),
        'protect.unheld:' || o.id::text);
    end if;
    return null;
  end if;

  select sa.country into v_country
    from public.seller_accounts sa where sa.id = o.seller_account_id;
  select cc.platform_fee_bps, cc.payout_hold_days
    into v_fee_bps, v_hold_days
    from public.country_configs cc where cc.country = v_country;

  v_protect_fee := case when v_protect then o.protect_fee_minor else 0 end;
  v_platform_fee := ((o.total_minor - v_protect_fee) * v_fee_bps) / 10000;
  v_seller_gross := o.total_minor - v_protect_fee - v_platform_fee;

  insert into public.order_settlements (
    order_id, payment_attempt_id, seller_account_id, currency,
    gross_minor, platform_fee_bps, hold_days,
    platform_fee_minor, seller_gross_minor, psp_fee_minor, protect_fee_minor,
    pending_minor, release_at
  )
  values (
    p_order_id, p_payment_attempt_id, o.seller_account_id, o.currency,
    o.total_minor, v_fee_bps, v_hold_days,
    v_platform_fee, v_seller_gross, v_psp_fee, v_protect_fee,
    v_seller_gross,
    case when not v_protect and o.fulfilled_at is not null
         then o.fulfilled_at + (v_hold_days || ' days')::interval end
  )
  on conflict (order_id) do nothing
  returning id into v_settlement_id;

  if v_settlement_id is null then return null; end if;

  perform public.post_ledger_transaction(
    'charge_capture',
    'charge_capture:' || p_order_id::text,
    o.currency,
    jsonb_build_array(
      jsonb_build_object('kind', 'processor_clearing', 'amount_minor', o.total_minor - v_psp_fee),
      jsonb_build_object('kind', 'processor_fees', 'amount_minor', v_psp_fee),
      jsonb_build_object('kind', 'seller_pending', 'seller_account_id', o.seller_account_id,
                         'amount_minor', -v_seller_gross),
      jsonb_build_object('kind', 'platform_revenue', 'amount_minor', -v_platform_fee),
      jsonb_build_object('kind', 'protect_fee_revenue', 'amount_minor', -v_protect_fee)
    ),
    o.seller_account_id,
    p_order_id,
    null, null,
    case when v_protect then 'Online payment captured (Protect)' else 'Online payment captured' end,
    jsonb_build_object('reference', p_reference, 'settlementId', v_settlement_id)
  );

  -- Creator commission, if this order earned one on the ledger path.
  perform public.post_creator_commission_accrual(c.id)
     from public.creator_commissions c
    where c.order_id = p_order_id and c.settlement = 'ledger';

  if v_protect then
    insert into public.order_protections (order_id, seller_account_id, state)
    values (o.id, o.seller_account_id, 'held')
    on conflict (order_id) do nothing;
    perform public.emit_domain_event('order', o.id, 'protect.held',
      jsonb_build_object('orderId', o.id, 'sellerAccountId', o.seller_account_id),
      'protect.held:' || o.id::text);
  end if;

  return v_settlement_id;
end;
$$;

/**
 * 202609250106 unchanged, plus: when an order's settlement releases, its
 * creator's share releases in the same pass if the commission's own hold has
 * also elapsed (release_creator_commission checks). If not, the nightly
 * release_due_creator_commissions picks it up once it has.
 */
create or replace function public.release_due_order_settlements()
returns integer language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  s record;
  v_released integer := 0;
begin
  for s in
    select st.id, st.order_id, st.seller_account_id, st.currency, st.pending_minor,
           o.protection_mode
    from public.order_settlements st
    join public.orders o on o.id = st.order_id
    left join public.order_protections p on p.order_id = st.order_id
    where st.status = 'pending'
      and st.frozen_at is null
      and st.release_at is not null
      and st.release_at <= now()
      and st.pending_minor > 0
      and o.payment_status = 'paid'
      and o.refund_status = 'none'
      and o.status <> 'cancelled'
      and (
        (o.protection_mode = 'none' and o.dispute_status = 'none')
        or (o.protection_mode = 'protect' and p.state = 'releasable')
      )
    order by st.release_at
    limit 200
    for update of st skip locked
  loop
    perform public.post_ledger_transaction(
      'hold_release',
      'hold_release:' || s.id::text,
      s.currency,
      jsonb_build_array(
        jsonb_build_object('kind', 'seller_pending', 'seller_account_id', s.seller_account_id,
                           'amount_minor', s.pending_minor),
        jsonb_build_object('kind', 'seller_available', 'seller_account_id', s.seller_account_id,
                           'amount_minor', -s.pending_minor)
      ),
      s.seller_account_id, s.order_id, null, null, 'Hold period elapsed');

    update public.order_settlements
    set status = 'released',
        released_minor = released_minor + s.pending_minor,
        pending_minor = 0,
        released_at = now()
    where id = s.id and status = 'pending';

    if s.protection_mode = 'protect' then
      update public.order_protections
         set state = 'released', released_at = now()
       where order_id = s.order_id and state = 'releasable';
      perform public.emit_domain_event('order', s.order_id, 'protect.released',
        jsonb_build_object('orderId', s.order_id, 'sellerAccountId', s.seller_account_id,
                           'amountMinor', s.pending_minor, 'currency', s.currency),
        'protect.released:' || s.order_id::text);
    end if;

    perform public.release_creator_commission(c.id)
       from public.creator_commissions c
      where c.order_id = s.order_id and c.settlement = 'ledger' and c.status = 'pending';

    v_released := v_released + 1;
  end loop;

  return v_released;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading it back
-- ---------------------------------------------------------------------------

/**
 * Commission totals split by how they are settled, so a seller can see what
 * SnapDuka paid for them versus what they recorded paying by hand, and a
 * creator can see which of their earnings will arrive in their SnapDuka wallet.
 *
 * SECURITY INVOKER: RLS decides the rows. A seller sees commissions on their
 * own shop, a creator sees their own. p_creator_id is a filter only.
 * Aggregated here because a JS sum over a select is capped at db.max_rows.
 */
create or replace function public.creator_commission_settlement_totals(p_creator_id uuid default null)
returns table (
  creator_id uuid,
  currency public.currency_code,
  settlement text,
  pending_minor bigint,
  payable_minor bigint,
  paid_minor bigint,
  reversed_minor bigint,
  clawed_back_minor bigint,
  commission_count integer
)
language sql stable security invoker set search_path = '' as $$
  select c.creator_id, c.currency, c.settlement,
         coalesce(sum(c.amount_minor) filter (where c.status = 'pending'), 0)::bigint,
         coalesce(sum(c.amount_minor) filter (where c.status = 'payable'), 0)::bigint,
         coalesce(sum(c.amount_minor) filter (where c.status = 'paid'), 0)::bigint,
         coalesce(sum(c.amount_minor) filter (where c.status = 'reversed'), 0)::bigint,
         coalesce(sum(c.ledger_clawed_back_minor), 0)::bigint,
         count(*)::integer
    from public.creator_commissions c
   where p_creator_id is null or c.creator_id = p_creator_id
   group by c.creator_id, c.currency, c.settlement
   order by c.creator_id, c.currency, c.settlement;
$$;

-- ---------------------------------------------------------------------------
-- Invariants (moved here from 0201 because they read columns added above)
-- ---------------------------------------------------------------------------

/**
 * 202609250106 plus creator checks:
 *  - creator_pending / creator_payout_reserved are never negative;
 *  - each creator's creator_pending equals the sum of what their ledger-settled
 *    commissions say is still held (creator_commissions.ledger_pending_minor,
 *    added in 202609250202). A mismatch means a posting and its commission row
 *    were updated apart, which is the one way creator money could go missing
 *    without the books themselves being unbalanced.
 */
create or replace function public.check_ledger_invariants()
returns table (check_name text, detail text)
language plpgsql stable security definer set search_path = '' set row_security = off as $$
begin
  return query
  select 'unbalanced_currency',
         format('%s is out by %s', e.currency, sum(e.amount_minor))
  from public.ledger_entries e
  group by e.currency having sum(e.amount_minor) <> 0;

  return query
  select 'balance_cache_drift',
         format('account %s (%s) cached %s, entries say %s',
                a.id, a.kind, a.balance_minor, coalesce(t.total, 0))
  from public.ledger_accounts a
  left join (
    select account_id,
           sum(amount_minor * (case when le.kind = 'debit' then 1 else -1 end)) as total
    from (
      select e.account_id, e.amount_minor,
             (select normal_balance from public.ledger_accounts x where x.id = e.account_id) as kind
      from public.ledger_entries e
    ) le group by account_id
  ) t on t.account_id = a.id
  where a.balance_minor <> coalesce(t.total, 0);

  return query
  select 'negative_restricted_balance',
         format('%s for %s is %s', a.kind,
                coalesce(a.owner_seller_account_id, a.owner_creator_id), a.balance_minor)
  from public.ledger_accounts a
  where a.kind in ('seller_pending', 'seller_payout_reserved', 'seller_dispute_reserve',
                   'creator_pending', 'creator_payout_reserved')
    and a.balance_minor < 0;

  return query
  select 'unbalanced_transaction', format('transaction %s', e.transaction_id)
  from public.ledger_entries e
  group by e.transaction_id
  having sum(e.amount_minor) <> 0 or count(*) < 2;

  return query
  select 'stuck_payout', format('payout %s has been processing since %s', p.reference, p.claimed_at)
  from public.payout_requests p
  where p.status = 'processing' and p.claimed_at < now() - interval '24 hours';

  return query
  select 'protect_release_without_confirmation', format('order %s', st.order_id)
  from public.order_settlements st
  join public.order_protections p on p.order_id = st.order_id
  where st.status = 'released' and p.state not in ('releasable', 'released');

  -- Creator pending vs the commissions that say what it holds. Both sides are
  -- aggregated first and full-joined, so an account with no commissions and a
  -- commission with no account both surface.
  return query
  select 'creator_pending_mismatch',
         format('creator %s %s: ledger holds %s, commissions say %s',
                coalesce(acct.creator_id, comm.creator_id), coalesce(acct.currency, comm.currency),
                coalesce(acct.held, 0), coalesce(comm.held, 0))
  from (
    select a.owner_creator_id as creator_id, a.currency, sum(a.balance_minor)::bigint as held
    from public.ledger_accounts a
    where a.kind = 'creator_pending'
    group by a.owner_creator_id, a.currency
  ) acct
  full join (
    select c.creator_id, c.currency, sum(c.ledger_pending_minor)::bigint as held
    from public.creator_commissions c
    where c.settlement = 'ledger'
    group by c.creator_id, c.currency
  ) comm on comm.creator_id = acct.creator_id and comm.currency = acct.currency
  where coalesce(acct.held, 0) <> coalesce(comm.held, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.guard_creator_commission_settlement() from public, anon, authenticated;
revoke all on function public.post_creator_commission_accrual(uuid) from public, anon, authenticated;
grant execute on function public.post_creator_commission_accrual(uuid) to service_role;
revoke all on function public.release_creator_commission(uuid) from public, anon, authenticated;
grant execute on function public.release_creator_commission(uuid) to service_role;
revoke all on function public.reverse_ledger_creator_commission(uuid, bigint, bigint, text)
  from public, anon, authenticated;
grant execute on function public.reverse_ledger_creator_commission(uuid, bigint, bigint, text) to service_role;
revoke all on function public.creator_commission_settlement_totals(uuid) from public, anon;
grant execute on function public.creator_commission_settlement_totals(uuid) to authenticated, service_role;
