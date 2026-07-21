-- supabase/migrations/202607210041_push_subscriptions_service_role_only.sql
-- push_own_insert used with check(true) — anyone could insert a push
-- subscription under an arbitrary seller_account_id or customer_id,
-- letting an attacker intercept another seller's push notifications. The
-- only real write path (src/app/api/push/subscribe/route.ts) already does
-- its own ownership verification and writes via the service-role admin
-- client, so the direct anon/authenticated grant was never actually needed.

drop policy push_own_insert on public.push_subscriptions;
revoke insert on public.push_subscriptions from anon, authenticated;
