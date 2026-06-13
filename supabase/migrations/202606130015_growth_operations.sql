create table public.export_jobs (
 id uuid primary key default gen_random_uuid(), seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
 export_type text not null, filters jsonb not null default '{}', state text not null default 'queued' check(state in ('queued','processing','ready','failed','expired')),
 object_path text, expires_at timestamptz, created_at timestamptz not null default now()
);
create table public.settlement_reconciliations (
 id uuid primary key default gen_random_uuid(), seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
 provider text not null, provider_reference text not null, expected_minor bigint not null, received_minor bigint,
 state text not null check(state in ('matched','missing','amount_mismatch')), details jsonb not null default '{}', checked_at timestamptz not null default now(),
 unique(provider,provider_reference)
);
create table public.risk_signals (
 id uuid primary key default gen_random_uuid(), seller_account_id uuid not null references public.seller_accounts(id) on delete cascade,
 signal_type text not null, score integer not null, details jsonb not null default '{}', state text not null default 'open' check(state in ('open','reviewing','resolved','dismissed')),
 created_at timestamptz not null default now()
);
alter table public.export_jobs enable row level security; alter table public.export_jobs force row level security;
alter table public.settlement_reconciliations enable row level security; alter table public.settlement_reconciliations force row level security;
alter table public.risk_signals enable row level security; alter table public.risk_signals force row level security;
create policy exports_owner_all on public.export_jobs for all to authenticated using(seller_account_id=(select public.current_seller_account_id())) with check(seller_account_id=(select public.current_seller_account_id()));
create policy settlements_owner_read on public.settlement_reconciliations for select to authenticated using(seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()));
create policy risks_operator_read on public.risk_signals for select to authenticated using((select public.is_operator()));
grant select,insert on public.export_jobs to authenticated;
grant select on public.settlement_reconciliations,public.risk_signals to authenticated;
grant all on public.export_jobs,public.settlement_reconciliations,public.risk_signals to service_role;
