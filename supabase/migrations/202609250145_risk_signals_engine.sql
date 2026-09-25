-- The risk engine starts writing risk_signals (squad C).
--
-- risk_signals has existed since the initial schema and has never had a row:
-- assessRisk() in src/lib/risk/signals.ts was written and never called. It is
-- now called (non-blocking) at checkout payment initialisation, payout
-- request and KYC result, and records what its rules find here for operators.
--
-- What this adds to the table:
--   * context        — where the signal was raised (checkout_init,
--                      payout_request, kyc_result), for triage;
--   * rules_version  — the code version of the rule set that fired, so a
--                      signal can be explained after the rules change;
--   * dedupe_key     — `<rule>:<subject id>`. Paystack initialise can be
--                      retried and KYC webhooks are redelivered; one finding
--                      per rule per subject, not one per retry.
--
-- Signals are observations, not actions. `risk_actions` requires an operator
-- (operator_user_id NOT NULL) and stays that way: nothing automated blocks a
-- sale or a payout yet. Which rules should later block is documented in
-- src/lib/risk/signals.ts.

alter table public.risk_signals
  add column context text,
  add column rules_version text,
  add column dedupe_key text;

alter table public.risk_signals
  add constraint risk_signals_context_check
    check (context is null or context in ('checkout_init', 'payout_request', 'kyc_result', 'scheduled')),
  add constraint risk_signals_score_check check (score between 0 and 100),
  add constraint risk_signals_details_check check (jsonb_typeof(details) = 'object'),
  add constraint risk_signals_dedupe_key_key unique (dedupe_key);

create index risk_signals_seller_created_idx on public.risk_signals (seller_account_id, created_at desc);
create index risk_signals_open_idx on public.risk_signals (created_at desc) where state = 'open';

-- Written by the server (service role) only; operators read through the
-- existing risks_operator_read policy.
revoke insert, update, delete on public.risk_signals from anon, authenticated;
