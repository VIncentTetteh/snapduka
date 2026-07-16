alter type public.notification_status add value if not exists 'dead_letter';

alter table public.notifications drop constraint if exists notifications_channel_check;
alter table public.notifications add constraint notifications_channel_check
  check(channel in ('email','whatsapp','push','in_app'));

alter table public.seller_subscriptions add column if not exists provider_email_token text;
