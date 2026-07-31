-- Retires the notification backlog that built up while no worker ran.
--
-- The notifications worker had never executed (see 202607310051_job_scheduler),
-- so 42 rows sat at 'pending' — the oldest from 2026-06-14, the newest 11 days
-- old. Turning the scheduler on without this would have flushed the entire
-- backlog on the first tick: buyers receiving "your order has shipped" for
-- orders that closed weeks ago, which reads as a broken shop and invites
-- support contacts about long-settled orders.
--
-- Only channels that deliver to a real person are retired. in_app rows are left
-- pending on purpose: they send nothing outward, the seller's notification bell
-- reads the table directly regardless of status, and letting the worker settle
-- them to 'sent' keeps the queue consistent.
--
-- dead_letter is the existing terminal give-up state (notification_status has
-- no 'expired'), and the reason is recorded on the row and in
-- notification_attempts so the gap is explainable later rather than looking
-- like silent data loss.
--
-- Idempotent and self-limiting: the 72-hour window means a fresh database or a
-- re-run touches nothing.

with retired as (
  update public.notifications
  set status = 'dead_letter',
      last_error = 'Retired undelivered: no notification worker was scheduled when this was queued, and the message was too old to send truthfully.'
  where status in ('pending', 'failed')
    and channel <> 'in_app'
    and created_at < now() - interval '72 hours'
  returning id, attempts
)
insert into public.notification_attempts (notification_id, attempt, outcome, error)
select id, attempts, 'dead_letter',
       'Retired by 202607310053: queued while no worker was scheduled.'
from retired;
