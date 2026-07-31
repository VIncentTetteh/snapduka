-- Stops a drifted counter from making a reservation impossible to ever finish.
--
-- finish_stock_reservation subtracted the reserved quantity with no floor. When
-- products.reserved_quantity had drifted below what an outstanding reservation
-- claimed, the subtraction pushed it negative, products_stock_check
-- (reserved_quantity >= 0) aborted the transaction, and the reservation stayed
-- 'active' — permanently. The sweep re-selected the same rows on every run and
-- failed on every run, silently, because the route counts successes and never
-- looks at the error.
--
-- Found the moment the sweep worker was scheduled for the first time: two
-- reservations on the demo shop, expired 2026-07-28 and 2026-07-29, against
-- products whose reserved_quantity was already 0. The stock was not actually
-- held by anyone; only the reservation rows were stale.
--
-- Clamping the release at zero is the correct reconciliation, not a papering
-- over. Tearing a reservation down must always be possible: if the counter
-- already excludes this reservation, subtracting again is the wrong arithmetic,
-- and refusing to terminate the row helps nobody.
--
-- stock_quantity is deliberately NOT clamped. On 'consumed' it decrements real
-- stock, and stock_quantity >= 0 is what stops an oversell — that one must keep
-- failing loudly.

create or replace function public.finish_stock_reservation(p_reservation_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path to ''
set row_security to 'off'
as $function$
declare
  reservation_record public.stock_reservations%rowtype;
begin
  if p_outcome not in ('released', 'consumed', 'expired') then
    raise exception using errcode = '22023', message = 'Invalid reservation outcome.';
  end if;

  select * into reservation_record
  from public.stock_reservations
  where id = p_reservation_id
  for update;

  if reservation_record.id is null or reservation_record.status <> 'active' then
    return;
  end if;

  if reservation_record.variant_id is not null then
    update public.product_variants
    set
      reserved_quantity = case
        when inventory_policy = 'track'
          then greatest(0, reserved_quantity - reservation_record.quantity)
        else reserved_quantity
      end,
      stock_quantity = case
        when p_outcome = 'consumed' and inventory_policy = 'track'
          then stock_quantity - reservation_record.quantity
        else stock_quantity
      end
    where id = reservation_record.variant_id;
  else
    update public.products
    set
      reserved_quantity = case
        when inventory_policy = 'track'
          then greatest(0, reserved_quantity - reservation_record.quantity)
        else reserved_quantity
      end,
      stock_quantity = case
        when p_outcome = 'consumed' and inventory_policy = 'track'
          then stock_quantity - reservation_record.quantity
        else stock_quantity
      end
    where id = reservation_record.product_id;
  end if;

  update public.stock_reservations
  set status = p_outcome
  where id = reservation_record.id;

  if p_outcome = 'consumed' then
    insert into public.inventory_movements (
      product_id, variant_id, seller_account_id, quantity_delta, reason, reference
    )
    values (
      reservation_record.product_id,
      reservation_record.variant_id,
      reservation_record.seller_account_id,
      -reservation_record.quantity,
      'sale',
      reservation_record.reference
    );
  end if;
end;
$function$;
