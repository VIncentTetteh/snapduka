-- No public function may be callable by anon (pgTAP 030), and that must not
-- depend on default privileges.
--
-- Found after applying 202609250102-0291 to production: production's public
-- schema still carries Supabase's default grant of EXECUTE to anon on every
-- new function, which the local stack revokes by default privileges
-- (202606120002). Seven functions were anon-executable there — four from this
-- release (three trigger functions and a pure hashing helper) and three that
-- predate it (save_onboarding_shop, seller_creator_commission_totals,
-- shop_slug_base). None was exploitable as far as can be seen (trigger
-- functions cannot be called directly; the definer RPC requires a seller
-- session), but anon has no business reaching any of them.
--
-- Revokes are explicit so they hold whatever the default privileges are.
-- Signed-in access is kept where the app uses it: save_onboarding_shop
-- (onboarding) and seller_creator_commission_totals (creators page).

revoke execute on function public.feature_flag_bucket(text, text) from public, anon, authenticated;
revoke execute on function public.guard_protected_order() from public, anon, authenticated;
revoke execute on function public.issue_code_on_dispatch() from public, anon, authenticated;
revoke execute on function public.open_protect_dispute_from_case() from public, anon, authenticated;
revoke execute on function public.shop_slug_base(text) from public, anon;

revoke execute on function public.save_onboarding_shop(text, text, text) from public, anon;
grant execute on function public.save_onboarding_shop(text, text, text) to authenticated, service_role;

revoke execute on function public.seller_creator_commission_totals() from public, anon;
grant execute on function public.seller_creator_commission_totals() to authenticated, service_role;
