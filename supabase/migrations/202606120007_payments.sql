create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  seller_account_id uuid not null references public.seller_accounts(id),
  provider text not null default 'paystack',
  reference text not null unique,
  amount_minor bigint not null,
  currency public.currency_code not null,
  status public.payment_status not null default 'pending',
  provider_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint provider_events_key unique(provider,event_key)
);
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  payment_attempt_id uuid not null references public.payment_attempts(id),
  seller_account_id uuid not null references public.seller_accounts(id),
  amount_minor bigint not null,
  provider_refund_id text,
  status public.refund_status not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refunds_amount_check check(amount_minor>0)
);
create table public.financial_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  event_type text not null,
  amount_minor bigint not null,
  currency public.currency_code not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create trigger payment_attempts_updated before update on public.payment_attempts for each row execute function public.set_updated_at();
create trigger refunds_updated before update on public.refunds for each row execute function public.set_updated_at();

create function public.apply_paystack_success(p_reference text,p_event_key text,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='' set row_security=off as $$
declare attempt public.payment_attempts%rowtype; order_record public.orders%rowtype;
begin
  insert into public.provider_events(provider,event_key,event_type,payload)
  values('paystack',p_event_key,'charge.success',p_payload) on conflict(provider,event_key) do nothing;
  if not found then return false; end if;
  select * into attempt from public.payment_attempts where reference=p_reference for update;
  if attempt.id is null then return false; end if;
  select * into order_record from public.orders where id=attempt.order_id for update;
  if (p_payload#>>'{data,status}') <> 'success'
    or (p_payload#>>'{data,amount}')::bigint <> order_record.total_minor
    or (p_payload#>>'{data,currency}') <> order_record.currency::text then
    update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
    return false;
  end if;
  update public.payment_attempts set status='paid',provider_data=p_payload->'data' where id=attempt.id;
  update public.orders set payment_status='paid',status=case when status='pending' then 'confirmed' else status end,event_version=event_version+1 where id=attempt.order_id;
  insert into public.financial_events(order_id,event_type,amount_minor,currency,data)
  values(attempt.order_id,'payment_succeeded',order_record.total_minor,order_record.currency,jsonb_build_object('reference',p_reference));
  insert into public.order_events(order_id,seller_account_id,event_type,actor_type,data)
  values(attempt.order_id,attempt.seller_account_id,'payment_succeeded','provider',jsonb_build_object('reference',p_reference));
  update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
  return true;
end; $$;

alter table public.payment_attempts enable row level security; alter table public.payment_attempts force row level security;
alter table public.provider_events enable row level security; alter table public.provider_events force row level security;
alter table public.refunds enable row level security; alter table public.refunds force row level security;
alter table public.financial_events enable row level security; alter table public.financial_events force row level security;
create policy payment_attempts_owner_operator on public.payment_attempts for select to authenticated using(seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()));
create policy refunds_owner_operator on public.refunds for select to authenticated using(seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()));
create policy provider_events_operator on public.provider_events for select to authenticated using((select public.is_operator()));
create policy financial_events_operator on public.financial_events for select to authenticated using((select public.is_operator()));
grant select on public.payment_attempts,public.refunds,public.provider_events,public.financial_events to authenticated;
grant execute on function public.apply_paystack_success(text,text,jsonb) to service_role;
grant all on public.payment_attempts,public.refunds,public.provider_events,public.financial_events to service_role;
