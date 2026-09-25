-- SnapDuka Protect: delivery codes, confirmation and timeouts.

-- ---------------------------------------------------------------------------
-- Issuing the delivery code
-- ---------------------------------------------------------------------------

/**
 * A fresh six-digit delivery code for a protected order, returned once.
 *
 * The code is stored only as a bcrypt hash. The plaintext travels to the buyer
 * inside a `protect.code_issued` outbox event, which the sender redacts after
 * delivery (redact_domain_event_keys). Re-issuing rotates the code, so "resend
 * my code" never needs the old plaintext and a leaked old code stops working.
 *
 * gen_random_bytes, not random(): random() is not a cryptographic source and a
 * delivery code is the only thing standing between a dishonest rider and the
 * buyer's money.
 */
create or replace function public.issue_delivery_code(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  p public.order_protections%rowtype;
  o public.orders%rowtype;
  cfg public.country_configs%rowtype;
  v_code text;
begin
  select * into p from public.order_protections where order_id = p_order_id for update;
  if p.order_id is null or p.state not in ('held', 'in_transit') then
    return null;
  end if;
  select * into o from public.orders where id = p_order_id;
  select cc.* into cfg from public.country_configs cc
    join public.seller_accounts sa on sa.country = cc.country
   where sa.id = o.seller_account_id;

  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');

  update public.order_protections
     set state = 'in_transit',
         delivery_code_hash = extensions.crypt(v_code, extensions.gen_salt('bf', 8)),
         code_issued_at = now(),
         code_attempts = 0,
         code_locked_until = null,
         dispatched_at = coalesce(dispatched_at, now()),
         auto_release_at = coalesce(auto_release_at,
                                    now() + make_interval(hours => cfg.protect_auto_release_hours))
   where order_id = p_order_id;

  perform public.emit_domain_event('order', p_order_id, 'protect.code_issued',
    jsonb_build_object(
      'orderId', p_order_id,
      'reference', o.public_reference,
      'trackingToken', o.tracking_token,
      'code', v_code));

  return v_code;
end;
$$;

revoke all on function public.issue_delivery_code(uuid) from public, anon, authenticated;
grant execute on function public.issue_delivery_code(uuid) to service_role;

-- Dispatch (or ready-for-pickup) is the moment the buyer needs their code, so
-- the trigger issues it on whichever path moved the order: the dashboard, the
-- app, the public API, a courier booking or a courier webhook.
create or replace function public.issue_code_on_dispatch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.protection_mode = 'protect'
     and new.fulfillment_status in ('dispatched', 'ready_for_pickup')
     and old.fulfillment_status is distinct from new.fulfillment_status
     and exists (select 1 from public.order_protections
                  where order_id = new.id and state = 'held') then
    perform public.issue_delivery_code(new.id);
  end if;
  return new;
end;
$$;

create trigger orders_issue_protect_code
  after update of fulfillment_status on public.orders
  for each row execute function public.issue_code_on_dispatch();

/** Removes keys (e.g. a delivery code) from an outbox event once delivered. */
create or replace function public.redact_domain_event_keys(p_id bigint, p_keys text[])
returns void language sql security definer set search_path = '' as $$
  update public.domain_events set payload = payload - p_keys where id = p_id;
$$;

revoke all on function public.redact_domain_event_keys(bigint, text[]) from public, anon, authenticated;
grant execute on function public.redact_domain_event_keys(bigint, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- Confirming delivery
-- ---------------------------------------------------------------------------

/** Moves a protected order to delivered + releasable. Internal: callers lock first. */
create or replace function public.protect_mark_delivered(p_order_id uuid, p_method text)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_hours smallint;
  v_inspection_ends timestamptz;
  v_seller uuid;
begin
  select cc.protect_inspection_hours, o.seller_account_id into v_hours, v_seller
    from public.orders o
    join public.seller_accounts sa on sa.id = o.seller_account_id
    join public.country_configs cc on cc.country = sa.country
   where o.id = p_order_id;

  -- A timeout has already given the buyer a week; no further inspection wait.
  v_inspection_ends := case when p_method = 'auto' then now()
                            else now() + make_interval(hours => v_hours) end;

  update public.order_protections
     set state = 'releasable',
         delivery_confirmed_at = now(),
         confirmation_method = p_method,
         inspection_ends_at = v_inspection_ends,
         delivery_code_hash = null
   where order_id = p_order_id;

  -- The guard on orders lets this one change through for this transaction only.
  perform set_config('snapduka.protect_release', 'on', true);
  update public.orders
     set fulfillment_status = 'fulfilled',
         status = case when status in ('confirmed', 'processing') then 'completed' else status end,
         event_version = event_version + 1
   where id = p_order_id;
  perform set_config('snapduka.protect_release', '', true);

  -- The ordinary settlement hold starts after the inspection window.
  update public.order_settlements
     set release_at = v_inspection_ends
   where order_id = p_order_id and status = 'pending';

  insert into public.order_events (order_id, seller_account_id, event_type, actor_type, buyer_visible, data)
  values (p_order_id, v_seller, 'protect_delivery_confirmed',
          case when p_method = 'auto' then 'system' else 'user' end::public.actor_type,
          true, jsonb_build_object('method', p_method, 'inspectionEndsAt', v_inspection_ends));

  perform public.emit_domain_event('order', p_order_id, 'protect.delivered',
    jsonb_build_object('orderId', p_order_id, 'method', p_method, 'inspectionEndsAt', v_inspection_ends),
    'protect.delivered:' || p_order_id::text);
end;
$$;

revoke all on function public.protect_mark_delivered(uuid, text) from public, anon, authenticated;

/**
 * Checks a delivery code (or accepts a buyer's own "I received it") and
 * confirms delivery.
 *
 * Returns one of: confirmed, invalid_code, locked, already_confirmed,
 * not_in_transit, not_found. Five wrong codes lock the order for 30 minutes so
 * a six-digit code cannot be brute-forced from the rider page.
 *
 * `buyer_tap` needs no code because the caller has already proven it is the
 * buyer (tracking token) — the route enforces that, this function is
 * service-role only.
 */
create or replace function public.confirm_delivery(
  p_order_id uuid,
  p_code text,
  p_method text
)
returns text
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  p public.order_protections%rowtype;
begin
  if p_method not in ('buyer_code', 'rider_code', 'buyer_tap', 'operator') then
    raise exception using errcode = '22023', message = 'Unknown confirmation method.';
  end if;

  select * into p from public.order_protections where order_id = p_order_id for update;
  if p.order_id is null then return 'not_found'; end if;
  if p.state in ('releasable', 'released') then return 'already_confirmed'; end if;
  if p.state <> 'in_transit' then return 'not_in_transit'; end if;

  if p_method in ('buyer_code', 'rider_code') then
    if p.code_locked_until is not null and p.code_locked_until > now() then
      return 'locked';
    end if;
    if p_code is null or p_code !~ '^[0-9]{6}$'
       or p.delivery_code_hash is null
       or extensions.crypt(p_code, p.delivery_code_hash) <> p.delivery_code_hash then
      update public.order_protections
         set code_attempts = case when code_attempts + 1 >= 5 then 0 else code_attempts + 1 end,
             code_locked_until = case when code_attempts + 1 >= 5
                                      then now() + interval '30 minutes' else code_locked_until end
       where order_id = p_order_id;
      return 'invalid_code';
    end if;
  end if;

  perform public.protect_mark_delivered(p_order_id, p_method);
  return 'confirmed';
end;
$$;

revoke all on function public.confirm_delivery(uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_delivery(uuid, text, text) to service_role;

/**
 * A courier's own "delivered" report. Evidence, not confirmation: it shortens
 * the timeout but never releases money by itself, because a seller's own rider
 * reporting "delivered" is exactly the fraud Protect exists to stop.
 */
create or replace function public.record_courier_delivery(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_hours smallint;
begin
  select cc.protect_courier_release_hours into v_hours
    from public.orders o
    join public.seller_accounts sa on sa.id = o.seller_account_id
    join public.country_configs cc on cc.country = sa.country
   where o.id = p_order_id;

  update public.order_protections
     set courier_delivered_at = coalesce(courier_delivered_at, now()),
         auto_release_at = least(coalesce(auto_release_at, 'infinity'::timestamptz),
                                 now() + make_interval(hours => v_hours))
   where order_id = p_order_id and state = 'in_transit';
  return found;
end;
$$;

revoke all on function public.record_courier_delivery(uuid) from public, anon, authenticated;
grant execute on function public.record_courier_delivery(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Timeouts
-- ---------------------------------------------------------------------------

/**
 * The Protect clock. Bounded per run and ordered by due time, so it cannot hit
 * the max_rows cap or hold locks for long, and `skip locked` so it never waits
 * on an order a buyer is confirming at the same moment.
 *
 * - in_transit past auto_release_at → delivered by timeout.
 * - held past the dispatch SLA → flagged once for operators; the buyer's money
 *   stays held (refunds are an operator decision, not a timer's).
 */
create or replace function public.protect_sweep(p_batch integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  r record;
  v_auto integer := 0;
  v_overdue integer := 0;
begin
  for r in
    select order_id from public.order_protections
     where state = 'in_transit' and auto_release_at <= now()
     order by auto_release_at
     limit least(greatest(p_batch, 1), 500)
     for update skip locked
  loop
    perform public.protect_mark_delivered(r.order_id, 'auto');
    v_auto := v_auto + 1;
  end loop;

  for r in
    select p.order_id, p.seller_account_id
      from public.order_protections p
      join public.seller_accounts sa on sa.id = p.seller_account_id
      join public.country_configs cc on cc.country = sa.country
     where p.state = 'held'
       and p.dispatch_overdue_at is null
       and p.held_at < now() - make_interval(hours => cc.protect_dispatch_sla_hours)
     order by p.held_at
     limit least(greatest(p_batch, 1), 500)
     for update of p skip locked
  loop
    update public.order_protections set dispatch_overdue_at = now() where order_id = r.order_id;
    perform public.emit_domain_event('order', r.order_id, 'protect.dispatch_overdue',
      jsonb_build_object('orderId', r.order_id, 'sellerAccountId', r.seller_account_id),
      'protect.dispatch_overdue:' || r.order_id::text);
    v_overdue := v_overdue + 1;
  end loop;

  return jsonb_build_object('autoConfirmed', v_auto, 'dispatchOverdue', v_overdue);
end;
$$;

revoke all on function public.protect_sweep(integer) from public, anon, authenticated;
grant execute on function public.protect_sweep(integer) to service_role;

select cron.schedule(
  'snapduka-protect-sweep',
  '*/5 * * * *',
  $$select public.run_internal_job('/api/internal/protect/sweep')$$
);
