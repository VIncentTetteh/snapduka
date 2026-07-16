-- Connected social accounts for direct publishing (TikTok / Meta platforms).
-- Tokens are sealed with AES-256-GCM in the app layer before storage.

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
  provider text not null check (provider in ('tiktok','instagram','facebook')),
  external_id text not null,
  handle text not null default '',
  access_token_sealed text not null,
  refresh_token_sealed text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'connected' check (status in ('connected','expired','revoked')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_account_id, provider)
);

alter table public.social_accounts enable row level security;
alter table public.social_accounts force row level security;

-- Sellers see and disconnect their own accounts; rows are written by the
-- OAuth callback via service role, never directly by clients.
create policy social_accounts_owner_read on public.social_accounts
for select to authenticated using(
  seller_account_id=(select public.current_seller_account_id())
);
create policy social_accounts_owner_delete on public.social_accounts
for delete to authenticated using(
  seller_account_id=(select public.current_seller_account_id())
);

grant select, delete on public.social_accounts to authenticated;
grant all on public.social_accounts to service_role;
