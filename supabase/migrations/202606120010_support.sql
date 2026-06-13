create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  seller_account_id uuid not null references public.seller_accounts(id),
  reason text not null,
  description text not null,
  status public.dispute_status not null default 'opened',
  resolution text,
  response_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_case_order_key unique(order_id),
  constraint support_reason_check check(reason in ('item_not_received','item_not_as_described','payment_issue','refund_request','other'))
);
create table public.case_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  actor_type public.actor_type not null,
  actor_id uuid,
  body text not null,
  operator_only boolean not null default false,
  created_at timestamptz not null default now(),
  constraint case_message_body_check check(btrim(body)<>'')
);
create table public.case_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  uploader_type public.actor_type not null,
  uploader_id uuid,
  object_path text not null,
  media_type text not null,
  created_at timestamptz not null default now()
);
create table public.risk_actions (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts(id),
  case_id uuid references public.support_cases(id),
  operator_user_id uuid not null references auth.users(id),
  action text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint risk_action_check check(action in ('warning','require_verification','restrict_payments','suspend','remove'))
);
create trigger support_cases_updated before update on public.support_cases for each row execute function public.set_updated_at();
alter table public.support_cases enable row level security; alter table public.support_cases force row level security;
alter table public.case_messages enable row level security; alter table public.case_messages force row level security;
alter table public.case_evidence enable row level security; alter table public.case_evidence force row level security;
alter table public.risk_actions enable row level security; alter table public.risk_actions force row level security;
create policy cases_seller_operator on public.support_cases for select to authenticated using(seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()));
create policy messages_seller_operator on public.case_messages for select to authenticated using(exists(select 1 from public.support_cases c where c.id=case_messages.case_id and (c.seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()))));
create policy evidence_seller_operator on public.case_evidence for select to authenticated using(exists(select 1 from public.support_cases c where c.id=case_evidence.case_id and (c.seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()))));
create policy risk_operator on public.risk_actions for select to authenticated using((select public.is_operator()));
grant select on public.support_cases,public.case_messages,public.case_evidence,public.risk_actions to authenticated;
grant all on public.support_cases,public.case_messages,public.case_evidence,public.risk_actions to service_role;
