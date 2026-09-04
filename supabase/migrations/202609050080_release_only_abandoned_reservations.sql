-- supabase/migrations/202609050080_release_only_abandoned_reservations.sql
--
-- Stop giving stock back for orders that are still alive.
--
-- create_guest_order reserves each line for 30 minutes. The sweep runs every 10
-- minutes and released **every** expired `active` reservation without ever
-- looking at the parent order. finalize_order_stock then only consumes
-- reservations still `active` — so by the time a seller marked an order
-- complete, or a slow mobile-money payment landed, there was nothing left to
-- consume and `products.stock_quantity` was never decremented.
--
-- Production shows it happened: of 9 reservations, 8 are `released` and 1
-- `consumed`, and four of those released rows belong to `completed` orders —
-- three of them `paid`. Those sellers' stock counts never moved.
--
-- The 30-minute TTL is right for what it was built for: an abandoned checkout
-- must not hold stock forever. It is wrong for everything else. This function
-- keeps the TTL and adds the missing question — will this order ever be
-- fulfilled?
--
--   Release  · the order is gone, or cancelled, or still unconfirmed AND unpaid
--   Hold     · money arrived (paid / partially_refunded), or is owed on
--              collection (offline_due), or the seller has taken it on
--              (confirmed / processing / completed)
--
-- `offline_due` is the case that matters most in these markets: a cash-on-
-- delivery order sits unpaid for days by design, and 4 of 5 live shops take no
-- online payment at all. Releasing its stock is what let a seller with three
-- units keep showing three and accept unlimited orders.

create or replace function public.release_abandoned_reservations(p_limit integer default 200)
returns table (reservation_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  r record;
begin
  for r in
    select res.id,
           ord.id as order_id,
           ord.status,
           ord.payment_status
    from public.stock_reservations res
    -- reference is 'order:<order_id>:<product_id>:<variant_id|base>', the same
    -- shape create_guest_order writes and finalize_order_stock matches on.
    left join public.orders ord
      on ord.id::text = split_part(res.reference, ':', 2)
    where res.status = 'active'
      and res.expires_at < now()
      and (
        -- No order behind it any more: nothing to hold for.
        ord.id is null
        or ord.status = 'cancelled'
        -- Abandoned checkout: never confirmed, never paid.
        or (ord.status in ('draft', 'pending')
            and ord.payment_status in ('unpaid', 'pending', 'failed'))
      )
    order by res.expires_at
    limit greatest(p_limit, 0)
  loop
    perform public.finish_stock_reservation(r.id, 'released');
    reservation_id := r.id;
    outcome := 'released';
    return next;
  end loop;
end;
$$;

comment on function public.release_abandoned_reservations(integer) is
  'Releases expired reservations only for orders that will never be fulfilled. A paid, confirmed or offline_due order keeps its stock reserved until finalize_order_stock consumes it.';

revoke all on function public.release_abandoned_reservations(integer) from public, anon, authenticated;
grant execute on function public.release_abandoned_reservations(integer) to service_role;
