-- A failing provider trips its circuit; a healthy one never does.

begin;

set local search_path = extensions, public;

select plan(4);

select ok(public.provider_available('paystack', 'GH'), 'an unseen provider is available');

select public.record_payment_outcome('paystack', 'GH', true) from generate_series(1, 20);
select ok(public.provider_available('paystack', 'GH'), 'successes keep it available');

select public.record_payment_outcome('hubtel', 'GH', false) from generate_series(1, 9);
select ok(public.provider_available('hubtel', 'GH'), 'fewer than 10 attempts never trips the circuit');

select public.record_payment_outcome('hubtel', 'GH', false);
select ok(not public.provider_available('hubtel', 'GH'), 'a majority of failures over 10 attempts opens the circuit');

select * from finish();
rollback;
