create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  seller_account_id uuid not null references public.seller_accounts(id),
  channel text not null,
  recipient text not null,
  template text not null,
  payload jsonb not null default '{}',
  status public.notification_status not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_channel_check check(channel in ('email','whatsapp','in_app')),
  constraint notifications_attempts_check check(attempts>=0)
);
create table public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  attempt integer not null,
  outcome text not null,
  error text,
  created_at timestamptz not null default now()
);
create trigger notifications_updated before update on public.notifications for each row execute function public.set_updated_at();

create function public.enqueue_order_notification(p_order_id uuid,p_event text)
returns void language plpgsql security definer set search_path='' set row_security=off as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id=p_order_id;
  if o.id is null then return; end if;
  insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
  values(o.id,o.seller_account_id,'email',o.buyer_snapshot->>'email','order_update',
    jsonb_build_object('reference',o.public_reference,'status',p_event,'trackingToken',o.tracking_token));
  insert into public.notifications(order_id,seller_account_id,channel,recipient,template,payload)
  values(o.id,o.seller_account_id,'in_app',o.seller_account_id::text,'seller_order_update',
    jsonb_build_object('reference',o.public_reference,'status',p_event));
end; $$;

alter table public.notifications enable row level security; alter table public.notifications force row level security;
alter table public.notification_attempts enable row level security; alter table public.notification_attempts force row level security;
create policy notifications_owner_operator on public.notifications for select to authenticated using(seller_account_id=(select public.current_seller_account_id()) or (select public.is_operator()));
create policy notification_attempts_operator on public.notification_attempts for select to authenticated using((select public.is_operator()));
grant select on public.notifications to authenticated;
grant execute on function public.enqueue_order_notification(uuid,text) to service_role;
grant all on public.notifications,public.notification_attempts to service_role;
