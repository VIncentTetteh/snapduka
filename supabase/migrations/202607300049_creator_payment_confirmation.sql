-- Lets a creator confirm or dispute a payment the seller recorded.
--
-- "Mark as paid" is a seller assertion — SnapDuka moved no money and cannot
-- verify that any did. Without a way for the creator to answer, the ledger is
-- one party's word presented as fact, which is exactly the shape that stops
-- being trusted after the first dishonest seller.
--
-- creator_commission_payments is read-only to authenticated (RLS checks row
-- ownership but not values), so this is a definer function rather than a
-- policy: a creator must be able to set confirmed_at on their own payment and
-- nothing else on it.

create function public.respond_to_creator_commission_payment(
  p_payment_id uuid,
  p_action text,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' set row_security = off as $fn$
declare
  v_creator uuid;
  v_payment public.creator_commission_payments%rowtype;
begin
  v_creator := public.current_creator_id();
  if v_creator is null then
    raise exception using errcode = '42501', message = 'Only a creator can respond to a payment.';
  end if;
  if p_action not in ('confirm', 'dispute') then
    raise exception using errcode = 'P0001', message = 'Unrecognised response.';
  end if;

  -- Scoped by creator_id, so one creator can never resolve another's payment.
  select * into v_payment from public.creator_commission_payments
   where id = p_payment_id and creator_id = v_creator;
  if v_payment.id is null then
    raise exception using errcode = '42501', message = 'That payment is not yours.';
  end if;
  if v_payment.confirmed_at is not null or v_payment.disputed_at is not null then
    raise exception using errcode = 'P0001', message = 'You have already responded to that payment.';
  end if;

  if p_action = 'confirm' then
    update public.creator_commission_payments
      set confirmed_at = now() where id = p_payment_id;
  else
    if coalesce(btrim(p_note), '') = '' then
      raise exception using errcode = 'P0001', message = 'Tell the shop what went wrong.';
    end if;
    update public.creator_commission_payments
      set disputed_at = now(), dispute_note = btrim(p_note) where id = p_payment_id;
  end if;

  return jsonb_build_object('paymentId', p_payment_id, 'action', p_action);
end; $fn$;

grant execute on function public.respond_to_creator_commission_payment(uuid, text, text) to authenticated;
