-- Plan & billing fix: give the Free plan an explicit capability set (it was
-- missing the growth-feature keys entirely, so nothing could be gated against
-- it) and seed purchasable GH/NG prices for Growth and Scale. Paystack plan
-- codes are created lazily at first checkout and written back to plan_prices,
-- so no dashboard setup is required beyond the secret key.

-- Plans are versioned and immutable once active (one active version per code):
-- retire Free v1 and publish v2 with the full entitlement vocabulary.
update public.plans set active = false where code = 'free' and version = 1 and active;

insert into public.plans (code, name, version, entitlements, active)
values (
  'free',
  'Free',
  2,
  '{
    "shops": 1,
    "products": 50,
    "staffAccounts": 1,
    "customDomain": false,
    "branding": false,
    "promotions": false,
    "campaigns": true,
    "exports": false,
    "customerSegments": 3,
    "broadcastsPerMonth": 0,
    "automationRules": 0,
    "apiKeys": 0,
    "discovery": true
  }'::jsonb,
  true
)
on conflict (code, version) do nothing;

-- Purchasable prices. Amounts are in minor units (pesewas / kobo) and are
-- operator-editable from /admin/plans; conflicts keep whatever the operator
-- already configured. Côte d'Ivoire rows stay inactive until Paystack XOF
-- billing is enabled for the account.
insert into public.plan_prices (plan_id, country, currency, interval, amount_minor, active)
select p.id, v.country::public.country_code, v.currency::public.currency_code, v.interval, v.amount_minor, true
from public.plans p
join (
  values
    ('growth', 'GH', 'GHS', 'monthly',     6000::bigint),
    ('growth', 'GH', 'GHS', 'yearly',     60000::bigint),
    ('scale',  'GH', 'GHS', 'monthly',    15000::bigint),
    ('scale',  'GH', 'GHS', 'yearly',    150000::bigint),
    ('growth', 'NG', 'NGN', 'monthly',  1000000::bigint),
    ('growth', 'NG', 'NGN', 'yearly',  10000000::bigint),
    ('scale',  'NG', 'NGN', 'monthly',  2500000::bigint),
    ('scale',  'NG', 'NGN', 'yearly',  25000000::bigint)
) as v(code, country, currency, interval, amount_minor)
  on v.code = p.code
where p.active
on conflict (plan_id, country, interval) do nothing;
