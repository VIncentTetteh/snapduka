-- Automated seller KYC (flag `kyc_auto`, roadmap Phase 1, squad C).
--
-- Until now verification was a manual operator toggle
-- (approveVerificationAction in src/app/admin/actions.ts). This adds the record
-- of each automated identity check and the one path by which a check's result
-- moves `seller_verifications.state`. The operator toggle keeps working
-- unchanged and always wins: see apply_kyc_result.
--
-- Data protection (Ghana Data Protection Act, 2012, Act 843): SnapDuka never
-- stores a Ghana Card number, an ID image or a selfie. The vendor holds those
-- under its own registration; we keep the vendor's reference, a masked id
-- ("GHA-*******12-3"), a match score and a small summary. `result` is
-- additionally guarded in SQL against the obvious raw-data keys, so a future
-- provider mapping that forgets this fails loudly instead of quietly storing
-- personal data.

create table public.kyc_checks (
  id uuid primary key default gen_random_uuid(),
  seller_account_id uuid not null references public.seller_accounts (id) on delete cascade,
  provider text not null,
  check_type text not null,
  provider_ref text not null,
  status text not null default 'pending',
  match_score numeric(5, 2),
  masked_id text,
  failure_reason text,
  result jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kyc_checks_provider_check check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint kyc_checks_type_check check (check_type in ('ghana_card', 'liveness', 'business_reg')),
  constraint kyc_checks_status_check
    check (status in ('pending', 'passed', 'failed', 'needs_review', 'expired', 'error')),
  constraint kyc_checks_provider_ref_check check (btrim(provider_ref) <> ''),
  constraint kyc_checks_match_score_check check (match_score is null or match_score between 0 and 100),
  -- A masked id shows at most its last four characters in clear.
  constraint kyc_checks_masked_id_check
    check (masked_id is null or (char_length(masked_id) <= 40 and masked_id ~ '\*')),
  constraint kyc_checks_failure_reason_check
    check (failure_reason is null or char_length(failure_reason) <= 200),
  constraint kyc_checks_result_check check (
    jsonb_typeof(result) = 'object'
    and not (result ?| array[
      'id_number', 'idNumber', 'pin', 'ghana_card_number', 'ghanaCardNumber',
      'image', 'images', 'selfie', 'photo', 'document_image', 'documentImage',
      'full_name', 'fullName', 'dob', 'date_of_birth', 'dateOfBirth', 'raw'
    ])
  ),
  constraint kyc_checks_provider_ref_key unique (provider, provider_ref)
);

comment on table public.kyc_checks is
  'One automated identity check per row. Holds vendor references and masked ids only - never ID numbers or images (Act 843).';

create index kyc_checks_seller_created_idx on public.kyc_checks (seller_account_id, created_at desc);
create index kyc_checks_pending_idx on public.kyc_checks (created_at) where status = 'pending';

alter table public.kyc_checks enable row level security;
alter table public.kyc_checks force row level security;
revoke all on public.kyc_checks from anon, authenticated;
grant select on public.kyc_checks to authenticated;

create trigger kyc_checks_set_updated_at
  before update on public.kyc_checks
  for each row execute function public.set_updated_at();

-- The owner sees their own checks (the settings page shows progress); an
-- operator sees all of them. Team members do not: identity checks are about the
-- account owner as a person. Nobody writes except through the functions below.
create policy kyc_checks_owner_operator_read on public.kyc_checks
  for select to authenticated
  using (
    seller_account_id = (select public.current_seller_account_id())
    or (select public.is_operator())
  );

-- ── Starting a check ────────────────────────────────────────────────────────
-- Records the check and moves the seller into `in_progress` — but only from a
-- state the seller could be in before any decision. An operator's `rejected` or
-- `suspended`, and an existing `verified`, are left exactly as they are.
create or replace function public.start_kyc_check(
  p_seller_account_id uuid,
  p_provider text,
  p_check_type text,
  p_provider_ref text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check_id uuid;
begin
  insert into public.kyc_checks (seller_account_id, provider, check_type, provider_ref, expires_at)
  values (p_seller_account_id, p_provider, p_check_type, p_provider_ref, p_expires_at)
  returning id into v_check_id;

  insert into public.seller_verifications (seller_account_id, state)
  values (p_seller_account_id, 'in_progress')
  on conflict (seller_account_id) do update
    set state = 'in_progress'
    where public.seller_verifications.state in ('not_started', 'needs_action');

  return v_check_id;
end;
$$;

-- ── Applying a result ───────────────────────────────────────────────────────
-- Called by the KYC webhook (and the status poll) with a result the provider
-- adapter has already normalised. Idempotent: vendors retry webhooks, and a
-- replay of a result already applied changes nothing.
--
-- What moves `seller_verifications.state`:
--   * passed, for an identity-bearing check (ghana_card, business_reg)
--       -> verified, with provider/provider_reference from this check, so
--          seller_verifications_verified_fields_check is satisfied and the
--          shop's verified badge (sync_shop_verified_at) follows.
--   * failed -> needs_action, so the seller is asked to try again.
--   * liveness alone, needs_review, error, expired -> no state change; a human
--     or another check decides.
-- What never moves:
--   * `rejected` and `suspended` are operator decisions. An automated pass must
--     not overturn a human who looked and said no.
--   * `verified` is never demoted by a failed check: a seller verified by an
--     operator, or by an earlier pass, keeps it. Re-verification on expiry is
--     a separate, explicit flow.
create or replace function public.apply_kyc_result(
  p_provider text,
  p_provider_ref text,
  p_status text,
  p_match_score numeric default null,
  p_masked_id text default null,
  p_failure_reason text default null,
  p_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.kyc_checks;
  v_state public.verification_state;
  v_new_state public.verification_state;
begin
  if p_status not in ('passed', 'failed', 'needs_review', 'expired', 'error', 'pending') then
    raise exception using errcode = '22023', message = 'Unknown KYC status ' || coalesce(p_status, 'null');
  end if;

  select * into v_check
    from public.kyc_checks
   where provider = p_provider and provider_ref = p_provider_ref
   for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_check');
  end if;

  -- Terminal results are final. A late "pending" or a replay is a no-op.
  if v_check.status in ('passed', 'failed', 'expired') or p_status = 'pending'
     or (v_check.status = p_status and v_check.completed_at is not null) then
    return jsonb_build_object('applied', false, 'reason', 'already_final',
      'checkId', v_check.id, 'status', v_check.status);
  end if;

  update public.kyc_checks
     set status = p_status,
         match_score = p_match_score,
         masked_id = p_masked_id,
         failure_reason = p_failure_reason,
         result = coalesce(p_result, '{}'::jsonb),
         completed_at = now()
   where id = v_check.id;

  select state into v_state
    from public.seller_verifications
   where seller_account_id = v_check.seller_account_id
   for update;

  v_new_state := null;
  if p_status = 'passed' and v_check.check_type in ('ghana_card', 'business_reg')
     and coalesce(v_state::text, 'not_started') in ('not_started', 'in_progress', 'needs_action') then
    v_new_state := 'verified';
  elsif p_status = 'failed'
     and coalesce(v_state::text, 'not_started') in ('not_started', 'in_progress', 'needs_action') then
    v_new_state := 'needs_action';
  end if;

  if v_new_state = 'verified' then
    insert into public.seller_verifications
      (seller_account_id, state, provider, provider_reference, checked_at, expires_at, metadata)
    values
      (v_check.seller_account_id, 'verified', v_check.provider, v_check.provider_ref, now(),
       v_check.expires_at,
       jsonb_build_object('kycCheckId', v_check.id, 'checkType', v_check.check_type,
                          'matchScore', p_match_score, 'source', 'kyc_auto'))
    on conflict (seller_account_id) do update
      set state = 'verified',
          provider = excluded.provider,
          provider_reference = excluded.provider_reference,
          checked_at = excluded.checked_at,
          expires_at = excluded.expires_at,
          metadata = excluded.metadata;
  elsif v_new_state = 'needs_action' then
    insert into public.seller_verifications (seller_account_id, state, metadata)
    values (v_check.seller_account_id, 'needs_action',
            jsonb_build_object('kycCheckId', v_check.id, 'failureReason', p_failure_reason))
    on conflict (seller_account_id) do update
      set state = 'needs_action',
          metadata = excluded.metadata;
  end if;

  -- Lets the risk engine and notifications react without polling. Same
  -- transaction as the state change, deduped per check and outcome.
  perform public.emit_domain_event(
    'seller', v_check.seller_account_id, 'kyc.result',
    jsonb_build_object('checkId', v_check.id, 'provider', v_check.provider,
                       'checkType', v_check.check_type, 'status', p_status,
                       'matchScore', p_match_score, 'verificationState', coalesce(v_new_state, v_state)),
    'kyc:' || v_check.id::text || ':' || p_status
  );

  return jsonb_build_object(
    'applied', true,
    'checkId', v_check.id,
    'sellerAccountId', v_check.seller_account_id,
    'status', p_status,
    'verificationState', coalesce(v_new_state, v_state)
  );
end;
$$;

revoke all on function public.start_kyc_check(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.start_kyc_check(uuid, text, text, text, timestamptz) to service_role;
revoke all on function public.apply_kyc_result(text, text, text, numeric, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_kyc_result(text, text, text, numeric, text, text, jsonb) to service_role;
