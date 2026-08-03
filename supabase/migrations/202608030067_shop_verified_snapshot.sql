-- Snapshot verification state onto the shop so the storefront can tell the
-- truth about it.
--
-- src/components/storefront/store-header.tsx rendered a green "Verified seller"
-- checkmark unconditionally, for every shop, from the day it was written. At the
-- time of this migration 4 of the 5 live published shops were showing that badge
-- to buyers while their seller_verifications.state was 'not_started'. PRD
-- ACC-008 requires the opposite: verified status is shown only when the
-- underlying checks are actually valid.
--
-- The storefront cannot read seller_verifications. It queries with the anon key
-- and 202606120002_rls.sql:146 restricts that table to the owning seller and
-- operators — correctly, since it carries provider references and review
-- metadata that are nobody else's business. So the public fact ("this shop is
-- verified") is snapshotted onto shops, the same way discovery_listings
-- snapshots ranking inputs rather than widening access to the source tables.
--
-- A trigger, not application code. The only writer today is the operator
-- decision in src/app/admin/actions.ts, but a badge that asserts trust must not
-- depend on every future writer remembering to update a second table.

alter table public.shops add column if not exists verified_at timestamptz;

comment on column public.shops.verified_at is
  'Set by sync_shop_verified_at when seller_verifications.state becomes verified, cleared when it leaves. Public mirror of a restricted table; never write it directly.';

create function public.sync_shop_verified_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- security definer because seller_verifications is written by the operator
  -- path while shops is owner-scoped; the trigger has to cross that boundary.
  -- It only ever touches one column on one row keyed by the row that fired it.
  update public.shops
     set verified_at = case
           when new.state = 'verified' then coalesce(verified_at, new.checked_at, statement_timestamp())
           else null
         end
   where seller_account_id = new.seller_account_id;
  return new;
end;
$$;

revoke execute on function public.sync_shop_verified_at() from public, anon, authenticated;

create trigger seller_verifications_sync_shop_verified
after insert or update of state on public.seller_verifications
for each row execute function public.sync_shop_verified_at();

-- Backfill. Without this every already-verified shop silently loses its badge
-- on deploy, which is the same class of lie in the other direction.
update public.shops s
   set verified_at = coalesce(v.checked_at, v.updated_at)
  from public.seller_verifications v
 where v.seller_account_id = s.seller_account_id
   and v.state = 'verified';
