-- Lets a caller hand back rate-limit quota it consumed but never used.
--
-- check_rate_limit increments before the work happens, which is correct — a
-- check-then-increment split is racy, and two concurrent requests would both
-- pass. But sendOtpAction consumed the caller's quota and only then asked
-- Supabase to send the code. When the send failed the quota stayed spent, so a
-- provider outage locked users out of their own account: five attempts, zero
-- codes delivered, "Too many attempts. Try again in 900 seconds."
--
-- This is not hypothetical. It is exactly what happened while SMTP pointed at an
-- unreachable host — every send timed out and burned an attempt.
--
-- Refunding after a confirmed failure keeps the atomic increment (so the limit
-- still holds under concurrency) while making a failed send cost nothing. Only
-- the caller decides what counts as a failure; this function just decrements.

create or replace function public.release_rate_limit(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Floors at zero and only touches a live window. A refund arriving after the
  -- window rolled over must not credit the next window, which would let a
  -- caller bank attempts.
  update public.rate_limit_counters
  set count = greatest(0, count - 1)
  where key = p_key
    and reset_at > clock_timestamp();
end;
$$;

comment on function public.release_rate_limit(text) is
  'Hands back one unit of quota consumed by check_rate_limit when the work it guarded provably did not happen (e.g. the OTP provider failed to send). Never call this on a failure the caller caused.';

revoke all on function public.release_rate_limit(text) from public;
revoke all on function public.release_rate_limit(text) from anon;
revoke all on function public.release_rate_limit(text) from authenticated;
grant execute on function public.release_rate_limit(text) to service_role;
