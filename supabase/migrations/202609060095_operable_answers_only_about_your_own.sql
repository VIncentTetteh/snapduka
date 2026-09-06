-- seller_account_operable should not answer questions about other people.
--
-- 202609060090 added it so team policies could ask whether the account being
-- acted on is still allowed to trade. It is SECURITY DEFINER and granted to
-- `authenticated`, because a policy expression is evaluated as the calling role
-- and every policy that references a function needs EXECUTE on it.
--
-- That put it on the REST surface as /rest/v1/rpc/seller_account_operable, and
-- it answered for any account id it was given. Seller account ids are not
-- secret — a shop row carries one and shops are publicly readable — so any
-- signed-in user could ask "is this seller suspended?" about anyone. Whether a
-- business has been sanctioned is not public information, and it is exactly the
-- sort of thing a competitor would find useful.
--
-- Confirmed against production before this migration: signed in as one seller,
-- seller_account_operable(<another seller's id>) returned true. The two
-- comparable functions that take a seller id — seller_wallet_balance and
-- seller_payout_destination — both already refuse with 42501, so this was the
-- odd one out rather than the house style.
--
-- The fix is to answer only about accounts the caller is actually part of. An
-- unrelated account now returns false, which is indistinguishable from
-- suspended, so the probe yields nothing either way.
--
-- This does not weaken any policy. Every use site ANDs it with a check that the
-- caller is the owner or an active team member of that same account, so the
-- relationship the function now requires is one the policy has already
-- established. Verified in a rollback with a real manager fixture: they still
-- read their shop's products and still create a campaign.

create or replace function public.seller_account_operable(p_seller_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.seller_accounts sa
    where sa.id = p_seller_account_id
      and sa.status = any (array['pending'::public.seller_account_status,
                                 'active'::public.seller_account_status])
      and (
        sa.auth_user_id = (select auth.uid())
        or exists (
          select 1 from public.team_memberships tm
          where tm.seller_account_id = sa.id
            and tm.auth_user_id = (select auth.uid())
            and tm.active
        )
      )
  );
$$;

comment on function public.seller_account_operable(uuid) is
  'True when the caller belongs to this account and it may still be operated. Returns false for an account the caller has no part in, so it cannot be used to probe another seller''s status.';
