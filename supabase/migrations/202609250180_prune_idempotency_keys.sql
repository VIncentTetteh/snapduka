-- Expired idempotency keys were only ever removed when the same key was reused,
-- so the table grew with every checkout and every offline mobile replay.
--
-- Keys expire after 24 hours (idempotency_keys.expires_at). Guest checkout and
-- the mobile replay guard only need them inside a retry window, so deleting
-- them a day after expiry changes no behaviour: a buyer retrying a checkout a
-- week later rightly places a new order. SQL-only, so no worker route.
select cron.schedule(
  'snapduka-prune-idempotency-keys',
  '40 4 * * *',
  $$delete from public.idempotency_keys where expires_at < now() - interval '1 day'$$
);
