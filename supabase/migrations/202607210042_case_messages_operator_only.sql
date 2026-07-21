-- supabase/migrations/202607210042_case_messages_operator_only.sql
-- case_messages.operator_only exists specifically to hide internal notes
-- (fraud reasoning, escalation context) from the seller under review, but
-- messages_seller_operator never checked it — a seller could read every
-- internal-only note on their own dispute/support case.

drop policy messages_seller_operator on public.case_messages;
create policy messages_seller_operator on public.case_messages for select to authenticated using(
  exists(
    select 1 from public.support_cases c
    where c.id = case_messages.case_id
      and (
        (c.seller_account_id = (select public.current_seller_account_id()) and not case_messages.operator_only)
        or (select public.is_operator())
      )
  )
);
