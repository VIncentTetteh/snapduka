-- Tell a creator when they earn, and when the money becomes payable.
--
-- 202609060096 gave creators their first notifications ever — accepted
-- partnership, recorded payment — but the two events that happen on their own,
-- with nobody pressing a button, still went unsent. Both live in SQL: accrual is
-- a trigger on orders.payment_status (so cash on delivery accrues too) and the
-- hold clock is released nightly by pg_cron. A creator posted a link and then
-- heard nothing until they thought to open the portal.
--
-- The enqueue rules — only an active creator, email when there is one and SMS
-- otherwise, never the same event twice for the same thing — now live here
-- rather than only in TypeScript, and `enqueueCreatorNotification` calls this
-- instead of restating them. Two copies of "who may be messaged" is exactly the
-- kind of thing that drifts silently.
--
-- The amount is stored as minor units plus its currency rather than a formatted
-- string, because the formatting is `Intl.NumberFormat` and SQL cannot reproduce
-- it. The worker formats, so both paths render identically.

create or replace function public.enqueue_creator_notification(
  p_creator_id uuid,
  p_seller_account_id uuid,
  p_event text,
  p_shop_name text,
  p_amount_minor bigint default null,
  p_currency public.currency_code default null,
  p_dedupe_key text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_email text;
  v_phone text;
  v_status text;
begin
  if p_event not in (
    'creator_partnership_accepted',
    'creator_commission_earned',
    'creator_commission_payable',
    'creator_payment_recorded'
  ) then
    raise exception using errcode = 'P0001', message = 'Unrecognised creator notification event.';
  end if;

  select c.contact_email, c.contact_phone, c.status::text
    into v_email, v_phone, v_status
  from public.creators c
  where c.id = p_creator_id;

  -- A suspended or closed creator is not messaged.
  if v_status is distinct from 'active' then return false; end if;

  if p_dedupe_key is not null and exists (
    select 1 from public.notifications n
    where n.template = p_event
      and n.payload->>'dedupeKey' = p_dedupe_key
  ) then
    -- Already sent for this exact thing; treat as delivered rather than sending
    -- a second copy.
    return true;
  end if;

  -- creators.contact_phone is NOT NULL and contact_email is optional, so SMS is
  -- the channel that always exists — the same order the invitation itself uses.
  insert into public.notifications (seller_account_id, channel, recipient, template, payload)
  values (
    -- Not the recipient: notifications.seller_account_id is NOT NULL and carries
    -- the shop the message is about. A creator has no seller account, and this
    -- column is what scopes the row for the worker and for support.
    p_seller_account_id,
    case when v_email is not null then 'email' else 'sms' end,
    coalesce(v_email, v_phone),
    p_event,
    jsonb_strip_nulls(jsonb_build_object(
      'event', p_event,
      'shopName', p_shop_name,
      'amountMinor', p_amount_minor,
      'currency', p_currency,
      'dedupeKey', p_dedupe_key
    ))
  );

  return true;
end;
$$;

revoke execute on function public.enqueue_creator_notification(uuid, uuid, text, text, bigint, public.currency_code, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_creator_notification(uuid, uuid, text, text, bigint, public.currency_code, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- "You earned X" — at accrual
-- ---------------------------------------------------------------------------

create or replace function public.accrue_creator_commission() returns trigger
language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  link public.campaign_links%rowtype;
  partnership public.creator_partnerships%rowtype;
  basis bigint;
  shop_name text;
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
  on conflict (order_id) do nothing
  returning * into accrued;

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

-- ---------------------------------------------------------------------------
-- "X is ready to be paid" — when the hold clock runs out
-- ---------------------------------------------------------------------------

create or replace function public.release_due_creator_commissions() returns integer
language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  released integer := 0;
  batch record;
begin
  -- One message per creator and currency rather than per commission: a shop that
  -- sells steadily can mature dozens in a night, and dozens of texts saying the
  -- same thing is not a notification, it is a reason to block the sender.
  for batch in
    with freed as (
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
        and o.status <> 'cancelled'
      returning c.id, c.creator_id, c.seller_account_id, c.currency,
                c.amount_minor, c.shop_display_name
    )
    select
      creator_id,
      seller_account_id,
      currency,
      -- Cast, because sum() over bigint returns numeric and there is no
      -- implicit numeric -> bigint: the call would fail to resolve, the handler
      -- below would swallow it, and the release would quietly stop notifying
      -- while still doing its job.
      sum(amount_minor)::bigint as amount_minor,
      min(shop_display_name) as shop_display_name,
      count(*)::integer as freed_count,
      -- A commission is released exactly once, so the smallest id in the batch
      -- identifies this release and no other. A date would collapse two genuine
      -- releases on the same day into one. Compared as text because Postgres
      -- has no min() over uuid.
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
      -- The release itself is the job; a message that could not be queued must
      -- not roll back money becoming payable.
      raise warning 'could not enqueue creator_commission_payable for %: %', batch.creator_id, sqlerrm;
    end;
  end loop;

  return released;
end; $$;
