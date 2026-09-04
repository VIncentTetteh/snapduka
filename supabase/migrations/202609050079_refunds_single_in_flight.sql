-- supabase/migrations/202609050079_refunds_single_in_flight.sql
--
-- One in-flight refund per order.
--
-- The refund route read the prior-refund total, decided how much was still
-- refundable, and only then called Paystack — writing the local row afterwards,
-- with its error discarded. Two concurrent callers therefore both computed the
-- full remaining amount and both sent it: read-committed means neither sees the
-- other's uncommitted claim, so no ordering of the application code closes this
-- on its own.
--
-- The route now claims the amount first, at `requested`, which the balance
-- query counts. This index is what makes that claim binding rather than merely
-- likely to win: the second concurrent insert raises 23505 and the route
-- reports "a refund is already in progress" instead of sending a second one.
--
-- Deliberately narrow. It constrains only refunds that have not settled, so a
-- genuine second partial refund is allowed once the first reaches `completed`
-- or `failed`.

create unique index refunds_one_in_flight_per_order
  on public.refunds (order_id)
  where status in ('requested', 'processing');
