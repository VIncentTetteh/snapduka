# Billing Plan Upgrades/Downgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sellers actually move between subscription tiers — upgrades take effect immediately, downgrades/cancellations take effect at the end of the paid period they already paid for (matching what the UI already promises), with no double-billing risk.

**Architecture:** A pending change is stored as extra nullable columns on the seller's existing `seller_subscriptions` row (not a second row — the table's `unique(seller_account_id)` stays untouched). Upgrades disable the old Paystack subscription and start a new checkout immediately. Downgrades/cancellations disable the old Paystack subscription immediately (stops future renewal) but leave `state`/`plan_id`/`current_period_end` untouched, so entitlements are unaffected until a daily cron applies the pending change once the period actually ends. As part of this fix, direct seller writes to `seller_subscriptions` are removed — sellers could previously set arbitrary `state`/period values themselves via Supabase's REST API (RLS only checked row ownership, not values); all writes now go through the service-role admin client from server actions.

**Tech Stack:** Next.js Server Actions, Supabase (Postgres/RLS), Paystack REST API, Vercel Cron.

## Global Constraints

- No live subscribers exist — no backward-compatible migration needed; `pnpm db:reset` is fine mid-implementation.
- Downgrades/cancellations take effect at `current_period_end`, never immediately.
- Upgrades take effect immediately, no proration.
- Undoing a scheduled downgrade is out of scope for this plan (a seller can re-run the upgrade flow for their current plan to restart billing — no new UI for that path here).
- Migration files: check `ls supabase/migrations | tail -3` before writing Task 1 — this plan assumes the next number is `202607190032`; bump if a later migration already exists.
- pgTAP test files: check `ls supabase/tests/database | tail -3` before writing Task 1 — this plan assumes `013_billing_plan_changes.test.sql`; bump if `013` is already taken.

---

### Task 1: Migration — pending plan changes + tighten seller_subscriptions writes

**Files:**
- Create: `supabase/migrations/202607190032_billing_plan_changes.sql`
- Create: `supabase/tests/database/013_billing_plan_changes.test.sql`

**Interfaces:**
- Produces: `seller_subscriptions.pending_plan_id`, `.pending_plan_version`, `.pending_price_id`, `.pending_change_type` (`'downgrade'|'cancel'|null`), `.provider_authorization_code` — consumed by Task 3 (webhook), Task 5 (`changePlan`), Task 6 (page UI), Task 7 (cron).
- Produces: `authenticated` no longer has `insert`/`update` on `seller_subscriptions` — Task 5's action must use `createAdminClient()` for every write to this table (the existing `createClient()`-based writes in the current `selectPlan`/`cancelSubscription` would silently fail after this task).

- [ ] **Step 1: Confirm the next migration/test numbers**

Run: `ls supabase/migrations | tail -3 && ls supabase/tests/database | tail -3`
Expected: confirms `202607190032` and `013` are free. If not, use the next free numbers in both filenames throughout this task.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/202607190032_billing_plan_changes.sql
-- Scheduled plan changes: a downgrade or cancellation now takes effect at
-- the end of the current paid period instead of revoking entitlements
-- immediately, matching what the billing page has always told sellers.
--
-- Also tightens seller_subscriptions writes to the service-role admin
-- client only. The existing owner insert/update policies
-- (202606130012_branding_domains.sql) let any authenticated seller set
-- arbitrary state/period values directly via Supabase's REST API — RLS
-- only checks row ownership, not values — bypassing Paystack checkout
-- entirely. All subscription writes now go through server actions using
-- createAdminClient(), which enforce real payment verification.

alter table public.seller_subscriptions
  add column pending_plan_id uuid references public.plans (id),
  add column pending_plan_version integer,
  add column pending_price_id uuid references public.plan_prices (id),
  add column pending_change_type text check (pending_change_type in ('downgrade', 'cancel')),
  add column provider_authorization_code text,
  add constraint seller_subscriptions_pending_shape_check check (
    (pending_change_type is null
      and pending_plan_id is null and pending_plan_version is null and pending_price_id is null)
    or (pending_change_type = 'cancel'
      and pending_plan_id is null and pending_plan_version is null and pending_price_id is null)
    or (pending_change_type = 'downgrade'
      and pending_plan_id is not null and pending_plan_version is not null and pending_price_id is not null)
  );

create index seller_subscriptions_pending_period_idx
  on public.seller_subscriptions (current_period_end)
  where pending_change_type is not null;

drop policy subscriptions_owner_insert on public.seller_subscriptions;
drop policy subscriptions_owner_update on public.seller_subscriptions;
revoke insert, update on public.seller_subscriptions from authenticated;
```

- [ ] **Step 3: Apply it locally and confirm it runs clean**

Run: `pnpm db:reset`
Expected: log shows `Applying migration 202607190032_billing_plan_changes.sql...` with no error, ending in `Finished supabase db reset`.

- [ ] **Step 4: Write the pgTAP test**

```sql
-- supabase/tests/database/013_billing_plan_changes.test.sql
begin;

set local search_path = extensions, public;

select plan(9);

select has_column('public', 'seller_subscriptions', 'pending_plan_id', 'has pending_plan_id');
select has_column('public', 'seller_subscriptions', 'pending_plan_version', 'has pending_plan_version');
select has_column('public', 'seller_subscriptions', 'pending_price_id', 'has pending_price_id');
select has_column('public', 'seller_subscriptions', 'pending_change_type', 'has pending_change_type');
select has_column('public', 'seller_subscriptions', 'provider_authorization_code', 'has provider_authorization_code');

select is(
  has_table_privilege('authenticated', 'public.seller_subscriptions', 'INSERT'),
  false,
  'sellers cannot insert their own subscription row directly'
);
select is(
  has_table_privilege('authenticated', 'public.seller_subscriptions', 'UPDATE'),
  false,
  'sellers cannot update their own subscription row directly'
);

-- Fixture: a seller with an active Growth subscription, to exercise the
-- pending-shape constraint.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000007101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'billing-fixture@example.com', '',
  now(), '{}'::jsonb, now(), now()
);
insert into public.seller_accounts (
  id, auth_user_id, country, status, is_active,
  contact_name, contact_email, contact_phone
)
values (
  '00000000-0000-0000-0000-000000007201',
  '00000000-0000-0000-0000-000000007101',
  'GH', 'active', true, 'Billing Fixture Seller',
  'billing-fixture@example.com', '+233241234574'
);
insert into public.seller_subscriptions (
  id, seller_account_id, plan_id, plan_version, state,
  current_period_start, current_period_end
)
select
  '00000000-0000-0000-0000-000000007301',
  '00000000-0000-0000-0000-000000007201',
  id, version, 'active', now(), now() + interval '30 days'
from public.plans where code = 'growth' and active;

-- A downgrade must carry all three pending fields together.
select throws_ok(
  $$
    update public.seller_subscriptions
    set pending_change_type = 'downgrade'
    where id = '00000000-0000-0000-0000-000000007301'
  $$,
  '23514',
  null,
  'a downgrade without pending_plan_id/version/price_id is rejected'
);

-- A cancel must NOT carry a pending plan.
select throws_ok(
  $$
    update public.seller_subscriptions
    set pending_change_type = 'cancel',
        pending_plan_id = (select id from public.plans where code = 'scale' and active)
    where id = '00000000-0000-0000-0000-000000007301'
  $$,
  '23514',
  null,
  'a cancel with a pending_plan_id is rejected'
);

select * from finish();
rollback;
```

- [ ] **Step 5: Run the pgTAP suite**

Run: `pnpm db:reset && pnpm db:test`
Expected: `013_billing_plan_changes.test.sql .. ok` in the output; only the known pre-existing unrelated `001_core.test.sql` plan-versioning failure remains (not caused by this task).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202607190032_billing_plan_changes.sql supabase/tests/database/013_billing_plan_changes.test.sql
git commit -m "feat: add pending plan-change columns, remove direct seller writes to seller_subscriptions"
```

---

### Task 2: Paystack — headless resubscribe + capture authorization/customer codes

**Files:**
- Modify: `src/lib/payments/paystack.ts`
- Modify: `src/lib/payments/types.ts`
- Modify: `src/lib/payments/paystack.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PaystackProvider.createSubscriptionForAuthorization({ customerCode, planCode, authorizationCode }): Promise<{ subscriptionCode: string; emailToken: string }>` — consumed by Task 7 (cron). `verify()`'s return type gains `authorizationCode: string | null` and `customerCode: string | null` — consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/payments/paystack.test.ts`:

```ts
describe("PaystackProvider.createSubscriptionForAuthorization", () => {
  it("subscribes an existing customer to a plan using a stored card authorization", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: true,
      data: { subscription_code: "SUB_x", email_token: "tok_x" },
    }), { status: 200 }));
    const provider = new PaystackProvider("sk_test_x", fetcher);
    const result = await provider.createSubscriptionForAuthorization({
      customerCode: "CUS_1", planCode: "PLN_1", authorizationCode: "AUTH_1",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.paystack.co/subscription",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      customer: "CUS_1", plan: "PLN_1", authorization: "AUTH_1",
    });
    expect(result).toEqual({ subscriptionCode: "SUB_x", emailToken: "tok_x" });
  });
});

describe("PaystackProvider.verify", () => {
  it("returns the authorization and customer codes from the transaction", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: true,
      data: {
        status: "success", amount: 6000, currency: "GHS", reference: "ref-1",
        authorization: { authorization_code: "AUTH_1" },
        customer: { customer_code: "CUS_1" },
      },
    }), { status: 200 }));
    const provider = new PaystackProvider("sk_test_x", fetcher);
    const result = await provider.verify("ref-1");
    expect(result).toEqual({
      status: "success", amountMinor: 6000, currency: "GHS", reference: "ref-1",
      authorizationCode: "AUTH_1", customerCode: "CUS_1",
    });
  });

  it("returns null authorization/customer codes when Paystack omits them", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: true,
      data: { status: "success", amount: 6000, currency: "GHS", reference: "ref-1" },
    }), { status: 200 }));
    const provider = new PaystackProvider("sk_test_x", fetcher);
    const result = await provider.verify("ref-1");
    expect(result.authorizationCode).toBeNull();
    expect(result.customerCode).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/payments/paystack.test.ts`
Expected: FAIL — `createSubscriptionForAuthorization is not a function`, and the two `verify` tests fail on missing `authorizationCode`/`customerCode` keys.

- [ ] **Step 3: Update `src/lib/payments/types.ts`**

Change the `verify` signature in the `PaymentProvider` interface from:

```ts
  verify(reference: string): Promise<{ status: string; amountMinor: number; currency: string; reference: string }>;
```

to:

```ts
  verify(reference: string): Promise<{
    status: string;
    amountMinor: number;
    currency: string;
    reference: string;
    authorizationCode: string | null;
    customerCode: string | null;
  }>;
```

- [ ] **Step 4: Update `src/lib/payments/paystack.ts`**

Change the `verify` method from:

```ts
  async verify(reference: string) {
    const data = await this.request(`/transaction/verify/${encodeURIComponent(reference)}`);
    return { status: data.status, amountMinor: data.amount, currency: data.currency, reference: data.reference };
  }
```

to:

```ts
  async verify(reference: string) {
    const data = await this.request(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      status: data.status,
      amountMinor: data.amount,
      currency: data.currency,
      reference: data.reference,
      authorizationCode: (data.authorization?.authorization_code as string | undefined) ?? null,
      customerCode: (data.customer?.customer_code as string | undefined) ?? null,
    };
  }
```

Add this new method after `disableSubscription`:

```ts
  /** Subscribes an already-charged customer to a plan using a stored card
   * authorization — no checkout redirect needed. Used by the plan-change
   * cron to apply a scheduled downgrade without a live seller session. */
  async createSubscriptionForAuthorization(input: { customerCode: string; planCode: string; authorizationCode: string }) {
    const data = await this.request("/subscription", {
      method: "POST",
      body: JSON.stringify({
        customer: input.customerCode,
        plan: input.planCode,
        authorization: input.authorizationCode,
      }),
    });
    return { subscriptionCode: data.subscription_code as string, emailToken: data.email_token as string };
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/payments/paystack.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean (confirms nothing else implementing `PaymentProvider` broke from the `verify` signature change — there is only `PaystackProvider`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/payments/paystack.ts src/lib/payments/types.ts src/lib/payments/paystack.test.ts
git commit -m "feat: add headless resubscribe and capture Paystack authorization/customer codes"
```

---

### Task 3: Webhook — pending-change-aware cancellation + capture billing identifiers

**Files:**
- Modify: `src/app/api/payments/paystack/subscription-webhook/route.ts`

**Interfaces:**
- Consumes: nothing new (the `admin` client already used in this file).
- Produces: nothing consumed by later tasks — this is a leaf fix.

- [ ] **Step 1: Replace the update-building section**

In `src/app/api/payments/paystack/subscription-webhook/route.ts`, replace lines 52-56:

```ts
  const update: Record<string, unknown> = { state: nextState, updated_at: new Date().toISOString() };
  if (nextState === "past_due") update.grace_ends_at = new Date(Date.now() + 7 * 86_400_000).toISOString();
  if (nextState === "active") update.grace_ends_at = null;
  if (nextState === "cancelled") update.cancelled_at = new Date().toISOString();
  await admin.from("seller_subscriptions").update(update).eq("id", subscription.id);
  return NextResponse.json({ received: true, applied: true });
```

with:

```ts
  const nowIso = new Date().toISOString();

  if (nextState === "cancelled") {
    // A pending scheduled change (set by changePlan) already disabled this
    // subscription on purpose — the daily apply-plan-changes cron is the
    // sole authority for that state transition once current_period_end
    // passes. Only record cancellation here when Paystack-side cancellation
    // was NOT solicited by us (e.g. the seller cancelled directly with
    // their bank, or an operator acted outside this app).
    const { data: current } = await admin
      .from("seller_subscriptions")
      .select("pending_change_type")
      .eq("id", subscription.id)
      .maybeSingle();
    if (current?.pending_change_type) {
      return NextResponse.json({ received: true, applied: true, pending: true });
    }
    await admin
      .from("seller_subscriptions")
      .update({ state: "cancelled", cancelled_at: nowIso, updated_at: nowIso })
      .eq("id", subscription.id);
    return NextResponse.json({ received: true, applied: true });
  }

  const update: Record<string, unknown> = { state: nextState, updated_at: nowIso };
  if (nextState === "past_due") update.grace_ends_at = new Date(Date.now() + 7 * 86_400_000).toISOString();
  if (nextState === "active") {
    update.grace_ends_at = null;
    const nextPaymentDate = payload.data?.next_payment_date ?? payload.data?.subscription?.next_payment_date;
    if (typeof nextPaymentDate === "string" && !Number.isNaN(new Date(nextPaymentDate).getTime())) {
      update.current_period_end = new Date(nextPaymentDate).toISOString();
    }
    const authorizationCode = payload.data?.authorization?.authorization_code;
    if (typeof authorizationCode === "string") update.provider_authorization_code = authorizationCode;
    const customerCode = payload.data?.customer?.customer_code;
    if (typeof customerCode === "string") update.provider_customer_code = customerCode;
  }
  await admin.from("seller_subscriptions").update(update).eq("id", subscription.id);
  return NextResponse.json({ received: true, applied: true });
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/payments/paystack/subscription-webhook/route.ts
git commit -m "fix: make webhook cancellation handling pending-change aware, capture billing identifiers"
```

---

### Task 4: Verify route — persist authorization/customer codes

**Files:**
- Modify: `src/app/api/payments/paystack/subscription-verify/route.ts`

**Interfaces:**
- Consumes: `verify()`'s extended return shape from Task 2 (`authorizationCode`, `customerCode`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the final subscription update**

In `src/app/api/payments/paystack/subscription-verify/route.ts`, replace:

```ts
  const now = new Date();
  await admin
    .from("seller_subscriptions")
    .update({
      state: "active",
      current_period_start: now.toISOString(),
      current_period_end: periodEnd(now, price.interval),
      grace_ends_at: null,
      cancelled_at: null,
      updated_at: now.toISOString(),
    })
    .eq("id", subscription.id);

  return NextResponse.json({ state: "active" });
```

with:

```ts
  const now = new Date();
  const updatePayload: Record<string, unknown> = {
    state: "active",
    current_period_start: now.toISOString(),
    current_period_end: periodEnd(now, price.interval),
    grace_ends_at: null,
    cancelled_at: null,
    updated_at: now.toISOString(),
  };
  if (verified.authorizationCode) updatePayload.provider_authorization_code = verified.authorizationCode;
  if (verified.customerCode) updatePayload.provider_customer_code = verified.customerCode;
  await admin.from("seller_subscriptions").update(updatePayload).eq("id", subscription.id);

  return NextResponse.json({ state: "active" });
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/payments/paystack/subscription-verify/route.ts
git commit -m "feat: persist Paystack authorization/customer codes on verify"
```

---

### Task 5: `changePlan` server action (replaces `selectPlan`)

**Files:**
- Modify: `src/app/(seller)/dashboard/settings/billing/actions.ts` (full file replacement)
- Create: `src/app/(seller)/dashboard/settings/billing/actions.test.ts`

**Interfaces:**
- Consumes: `paystackProvider().disableSubscription`, `.createPlan`, `.initializeSubscription` (existing), `createAdminClient` from `@/lib/supabase/admin`.
- Produces: `changePlan(formData: FormData): Promise<void>` (form field `planCode`: `"free"|"growth"|"scale"`, `interval`: `"monthly"|"yearly"`) and `cancelSubscription(): Promise<void>` — both consumed by Task 6 (page.tsx forms).

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/(seller)/dashboard/settings/billing/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  disableSubscription: vi.fn(),
  createPlan: vi.fn(),
  initializeSubscription: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/payments/paystack", () => ({
  paystackProvider: () => ({
    disableSubscription: mocks.disableSubscription,
    createPlan: mocks.createPlan,
    initializeSubscription: mocks.initializeSubscription,
  }),
}));

import { cancelSubscription, changePlan } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

const SELLER_ACTOR = {
  kind: "seller" as const,
  authenticated: true,
  userId: "u1",
  email: "seller@example.com",
  sellerAccountId: "seller-1",
  country: "GH" as const,
  status: "active" as const,
};

/** Builds a chainable query-builder mock: every method returns `this`,
 * and the given terminal result resolves whichever method is called last. */
function queryMock(result: unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  ["select", "eq", "in", "not", "lte"].forEach((method) => {
    chain[method] = vi.fn(self);
  });
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.upsert = vi.fn().mockReturnValue({ ...chain, then: undefined });
  chain.update = vi.fn(self);
  chain.delete = vi.fn(self);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
});

describe("changePlan", () => {
  it("upgrades Free to Growth: no disableSubscription call, starts checkout", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: null });
      if (table === "plans") return queryMock({ data: { id: "plan-growth", name: "Growth", version: 1 } });
      if (table === "plan_prices") {
        return queryMock({
          data: { id: "price-1", amount_minor: 6000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_growth" },
        });
      }
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({ from: () => ({ upsert, delete: () => ({ eq: () => ({ eq: vi.fn() }) }) }) });
    mocks.initializeSubscription.mockResolvedValue({ authorizationUrl: "https://checkout.paystack.com/x", reference: "ref-1" });

    await expect(changePlan(formData({ planCode: "growth", interval: "monthly" }))).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.paystack.com/x",
    );

    expect(mocks.disableSubscription).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: "plan-growth", state: "trialing", pending_change_type: null }),
      { onConflict: "seller_account_id" },
    );
  });

  it("upgrading Growth to Scale disables the old subscription before starting the new checkout", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z",
      provider_subscription_code: "SUB_old", provider_email_token: "tok_old",
      plans: { code: "growth" }, plan_prices: { interval: "monthly" },
    };
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: existing });
      if (table === "plans") return queryMock({ data: { id: "plan-scale", name: "Scale", version: 1 } });
      if (table === "plan_prices") {
        return queryMock({
          data: { id: "price-2", amount_minor: 15000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_scale" },
        });
      }
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({ from: () => ({ upsert, delete: () => ({ eq: () => ({ eq: vi.fn() }) }) }) });
    mocks.disableSubscription.mockResolvedValue(undefined);
    mocks.initializeSubscription.mockResolvedValue({ authorizationUrl: "https://checkout.paystack.com/y", reference: "ref-2" });

    await expect(changePlan(formData({ planCode: "scale", interval: "monthly" }))).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.disableSubscription).toHaveBeenCalledWith("SUB_old", "tok_old");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ plan_id: "plan-scale" }), { onConflict: "seller_account_id" });
  });

  it("downgrading Scale to Growth schedules the change and leaves state/plan untouched", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z",
      provider_subscription_code: "SUB_old", provider_email_token: "tok_old",
      plans: { code: "scale" }, plan_prices: { interval: "monthly" },
    };
    const fromRead = vi.fn((table: string) => {
      if (table === "seller_subscriptions") return queryMock({ data: existing });
      if (table === "plans") return queryMock({ data: { id: "plan-growth", version: 1 } });
      if (table === "plan_prices") return queryMock({ data: { id: "price-growth-monthly" } });
      return queryMock({ data: null });
    });
    mocks.createClient.mockResolvedValue({ from: fromRead });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update }) });
    mocks.disableSubscription.mockResolvedValue(undefined);

    await changePlan(formData({ planCode: "growth", interval: "monthly" }));

    expect(mocks.disableSubscription).toHaveBeenCalledWith("SUB_old", "tok_old");
    expect(mocks.initializeSubscription).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        pending_change_type: "downgrade",
        pending_plan_id: "plan-growth",
        pending_price_id: "price-growth-monthly",
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/settings/billing");
  });

  it("already on this plan is rejected", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z",
      provider_subscription_code: null, provider_email_token: null,
      plans: { code: "growth" }, plan_prices: { interval: "monthly" },
    };
    mocks.createClient.mockResolvedValue({ from: () => queryMock({ data: existing }) });

    await expect(changePlan(formData({ planCode: "growth", interval: "monthly" }))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/settings/billing?error=You%20are%20already%20on%20this%20plan.",
    );
  });
});

describe("cancelSubscription", () => {
  it("schedules a cancel-to-Free the same way changePlan(planCode=free) does", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    const existing = {
      id: "sub-1", state: "active", grace_ends_at: null, current_period_end: "2026-08-01T00:00:00Z",
      provider_subscription_code: "SUB_old", provider_email_token: "tok_old",
      plans: { code: "growth" }, plan_prices: { interval: "monthly" },
    };
    mocks.createClient.mockResolvedValue({ from: () => queryMock({ data: existing }) });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update }) });
    mocks.disableSubscription.mockResolvedValue(undefined);

    await cancelSubscription();

    expect(mocks.disableSubscription).toHaveBeenCalledWith("SUB_old", "tok_old");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ pending_change_type: "cancel" }));
  });

  it("nothing to cancel on Free is rejected", async () => {
    mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
    mocks.createClient.mockResolvedValue({ from: () => queryMock({ data: null }) });

    await expect(cancelSubscription()).rejects.toThrow("NEXT_REDIRECT");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/\(seller\)/dashboard/settings/billing/actions.test.ts`
Expected: FAIL — `changePlan is not exported`.

- [ ] **Step 3: Replace `src/app/(seller)/dashboard/settings/billing/actions.ts` in full**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { appOrigin } from "@/lib/app-url";
import { resolveServerActor } from "@/lib/auth/actor";
import { effectiveSubscriptionState, type SubscriptionState } from "@/lib/billing/subscriptions";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function fail(message: string): never {
  redirect(`/dashboard/settings/billing?error=${encodeURIComponent(message)}`);
}

const TIER: Record<string, number> = { free: 0, growth: 1, scale: 2 };

export async function changePlan(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role || actor.status !== "active") return;
  const planCode = String(formData.get("planCode") ?? "");
  const interval = String(formData.get("interval") ?? "monthly");
  if (!["free", "growth", "scale"].includes(planCode)) return;
  if (planCode !== "free" && !["monthly", "yearly"].includes(interval)) return;
  if (!process.env.PAYSTACK_SECRET_KEY) fail("Online billing is not configured yet. Contact support.");

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: existing } = await supabase
    .from("seller_subscriptions")
    .select(
      "id,state,grace_ends_at,current_period_end,provider_subscription_code,provider_email_token,plans(code),plan_prices(interval)",
    )
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();

  const existingPlan = existing?.plans as { code?: string } | { code?: string }[] | null;
  const existingPlanCode = (Array.isArray(existingPlan) ? existingPlan[0]?.code : existingPlan?.code) ?? "free";
  const existingPriceRow = existing?.plan_prices as { interval?: string } | { interval?: string }[] | null;
  const existingInterval =
    (Array.isArray(existingPriceRow) ? existingPriceRow[0]?.interval : existingPriceRow?.interval) ?? "monthly";
  const existingState = existing
    ? effectiveSubscriptionState({ state: existing.state as SubscriptionState, graceEndsAt: existing.grace_ends_at })
    : "expired";
  const isEntitled = existingState === "active" || existingState === "grace";

  if (isEntitled && existingPlanCode === planCode) fail("You are already on this plan.");
  if (!isEntitled && planCode === "free") fail("Nothing to cancel — you are already on Free.");

  const targetTier = TIER[planCode];
  const currentTier = isEntitled ? TIER[existingPlanCode] : 0;
  const isUpgrade = planCode !== "free" && (!isEntitled || targetTier > currentTier);

  if (!isUpgrade) {
    // Downgrade or cancel: keep current entitlements until current_period_end,
    // disable the old Paystack subscription now so it stops renewing, and
    // record the intended change for the daily cron to apply once the
    // period actually ends.
    if (!isEntitled) fail("Nothing to change.");
    if (existing?.provider_subscription_code && existing.provider_email_token) {
      try {
        await paystackProvider().disableSubscription(existing.provider_subscription_code, existing.provider_email_token);
      } catch {
        fail("Paystack could not update your current subscription. Try again shortly.");
      }
    }
    if (!existing?.current_period_end) {
      // Never left trialing — nothing paid to preserve, cancel immediately.
      await admin
        .from("seller_subscriptions")
        .update({ state: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", existing!.id);
      revalidatePath("/dashboard/settings/billing");
      revalidatePath("/dashboard", "layout");
      return;
    }
    if (planCode === "free") {
      await admin
        .from("seller_subscriptions")
        .update({
          pending_change_type: "cancel",
          pending_plan_id: null,
          pending_plan_version: null,
          pending_price_id: null,
        })
        .eq("id", existing.id);
    } else {
      const { data: plan } = await supabase.from("plans").select("id,version").eq("code", planCode).eq("active", true).single();
      if (!plan) fail("This plan is not available.");
      const { data: price } = await supabase
        .from("plan_prices")
        .select("id")
        .eq("plan_id", plan.id)
        .eq("country", actor.country)
        .eq("interval", existingInterval)
        .eq("active", true)
        .maybeSingle();
      if (!price) fail("This plan is not priced for your billing interval yet.");
      await admin
        .from("seller_subscriptions")
        .update({
          pending_change_type: "downgrade",
          pending_plan_id: plan.id,
          pending_plan_version: plan.version,
          pending_price_id: price.id,
        })
        .eq("id", existing.id);
    }
    revalidatePath("/dashboard/settings/billing");
    revalidatePath("/dashboard", "layout");
    return;
  }

  // Upgrade now (Free→paid, paid→higher tier, or resubscribe after cancelled).
  if (!actor.email) fail("Your account has no billing email.");

  const { data: plan } = await supabase.from("plans").select("id,name,version").eq("code", planCode).eq("active", true).single();
  if (!plan) fail("This plan is not available.");

  const { data: price } = await supabase
    .from("plan_prices")
    .select("id,amount_minor,currency,interval,provider_plan_code")
    .eq("plan_id", plan.id)
    .eq("country", actor.country)
    .eq("interval", interval)
    .eq("active", true)
    .maybeSingle();
  if (!price || price.amount_minor <= 0) fail("This plan is not priced for your country yet.");

  if (existing?.provider_subscription_code && existing.provider_email_token) {
    try {
      await paystackProvider().disableSubscription(existing.provider_subscription_code, existing.provider_email_token);
    } catch {
      fail("Paystack could not update your current subscription. Try again shortly.");
    }
  }

  let providerPlanCode = price.provider_plan_code;
  if (!providerPlanCode) {
    try {
      const created = await paystackProvider().createPlan({
        name: `SnapDuka ${plan.name} (${price.currency} ${interval})`,
        interval: interval === "yearly" ? "annually" : "monthly",
        amountMinor: price.amount_minor,
        currency: price.currency,
      });
      providerPlanCode = created.planCode;
    } catch {
      fail("Paystack could not prepare this plan. Try again shortly.");
    }
    await admin.from("plan_prices").update({ provider_plan_code: providerPlanCode }).eq("id", price.id);
  }

  const { error } = await admin.from("seller_subscriptions").upsert(
    {
      seller_account_id: actor.sellerAccountId,
      plan_id: plan.id,
      plan_version: plan.version,
      price_id: price.id,
      state: "trialing",
      current_period_start: new Date().toISOString(),
      current_period_end: null,
      grace_ends_at: null,
      cancelled_at: null,
      pending_change_type: null,
      pending_plan_id: null,
      pending_plan_version: null,
      pending_price_id: null,
    },
    { onConflict: "seller_account_id" },
  );
  if (error) fail("Subscription could not be prepared.");

  let authorizationUrl: string | null = null;
  try {
    const payment = await paystackProvider().initializeSubscription({
      email: actor.email,
      amountMinor: price.amount_minor,
      currency: price.currency,
      reference: `subscription-${actor.sellerAccountId}-${randomUUID()}`,
      planCode: providerPlanCode,
      callbackUrl: `${await appOrigin()}/dashboard/settings/billing?payment=pending`,
      metadata: { purpose: "subscription", sellerAccountId: actor.sellerAccountId, priceId: price.id },
    });
    authorizationUrl = payment.authorizationUrl;
  } catch {
    await admin
      .from("seller_subscriptions")
      .delete()
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("state", "trialing");
  }
  if (!authorizationUrl) fail("Paystack could not start billing.");
  redirect(authorizationUrl);
}

export async function cancelSubscription() {
  const formData = new FormData();
  formData.set("planCode", "free");
  await changePlan(formData);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/app/\(seller\)/dashboard/settings/billing/actions.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(seller\)/dashboard/settings/billing/actions.ts src/app/\(seller\)/dashboard/settings/billing/actions.test.ts
git commit -m "feat: add changePlan action supporting upgrade-now and schedule-at-period-end"
```

---

### Task 6: Billing page UI — pending-change display and real Free/downgrade buttons

**Files:**
- Modify: `src/app/(seller)/dashboard/settings/billing/page.tsx` (full file replacement)

**Interfaces:**
- Consumes: `changePlan`, `cancelSubscription` from `./actions` (Task 5).
- Produces: nothing consumed by later tasks — this is the feature's final visible wiring.

- [ ] **Step 1: Replace `src/app/(seller)/dashboard/settings/billing/page.tsx` in full**

```tsx
import Link from "next/link";
import { Suspense } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan } from "@/lib/billing/resolve";
import type { EntitlementValue } from "@/lib/billing/entitlements";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";

import { cancelSubscription, changePlan } from "./actions";
import { SubscriptionVerifier } from "./subscription-verifier";

type PlanRow = {
  code: string;
  name: string;
  entitlements: Record<string, EntitlementValue>;
  plan_prices: {
    id: string;
    country: string;
    currency: string;
    interval: string;
    amount_minor: number;
    active: boolean;
  }[];
};

const STATE_TONE: Record<string, BadgeTone> = {
  active: "success",
  grace: "warn",
  past_due: "warn",
  trialing: "neutral",
  cancelled: "neutral",
  expired: "danger",
  free: "accent",
};

const TIER: Record<string, number> = { free: 0, growth: 1, scale: 2 };

/** Human bullets from the entitlements JSON, in presentation order. */
function featureBullets(entitlements: Record<string, EntitlementValue>): string[] {
  const n = (key: string) => entitlements[key];
  const bullets: (string | null)[] = [
    typeof n("products") === "number" ? `Up to ${n("products")} products` : null,
    typeof n("staffAccounts") === "number"
      ? Number(n("staffAccounts")) > 1
        ? `${n("staffAccounts")} staff accounts`
        : "Owner account only"
      : null,
    n("campaigns") === true ? "Tracked share links" : null,
    n("promotions") === true ? "Discount promotions" : null,
    typeof n("customerSegments") === "number" && Number(n("customerSegments")) > 0
      ? `${n("customerSegments")} customer segments`
      : null,
    typeof n("broadcastsPerMonth") === "number" && Number(n("broadcastsPerMonth")) > 0
      ? `${n("broadcastsPerMonth")} broadcasts per month`
      : null,
    n("branding") === true ? "Storefront theming" : null,
    n("customDomain") === true ? "Custom domain" : null,
    n("exports") === true ? "CSV order exports" : null,
    typeof n("automationRules") === "number" && Number(n("automationRules")) > 0
      ? `${n("automationRules")} automation rules`
      : null,
    typeof n("apiKeys") === "number" && Number(n("apiKeys")) > 0
      ? `${n("apiKeys")} API keys + webhooks`
      : null,
    n("courierIntegrations") === true ? "Courier integrations" : null,
    n("discovery") === true ? "Discovery listing" : null,
  ];
  return bullets.filter((bullet): bullet is string => Boolean(bullet));
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; payment?: string }>;
}) {
  const feedback = await searchParams;
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [{ data: plans }, { data: subscription }, plan] = await Promise.all([
    supabase
      .from("plans")
      .select("code,name,entitlements,plan_prices(id,country,currency,interval,amount_minor,active)")
      .eq("active", true)
      .in("code", ["free", "growth", "scale"]),
    supabase
      .from("seller_subscriptions")
      .select(
        "state,current_period_end,grace_ends_at,cancelled_at,pending_change_type,plans(code,name),pending_plan:plans!pending_plan_id(name)",
      )
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle(),
    getSellerPlan(actor.sellerAccountId),
  ]);

  const ordered = ["free", "growth", "scale"]
    .map((code) => (plans as PlanRow[] | null)?.find((row) => row.code === code))
    .filter((row): row is PlanRow => Boolean(row));
  const subscribedPlan = subscription?.plans as { code?: string; name?: string } | null;
  const renewsAt = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const pendingPlanRow = subscription?.pending_plan as { name?: string } | { name?: string }[] | null;
  const pendingPlanName = Array.isArray(pendingPlanRow) ? pendingPlanRow[0]?.name : pendingPlanRow?.name;
  const pendingLabel =
    subscription?.pending_change_type && renewsAt
      ? subscription.pending_change_type === "cancel"
        ? `Switching to Free on ${renewsAt}`
        : `Switching to ${pendingPlanName ?? "a different plan"} on ${renewsAt}`
      : null;

  const isEntitled = plan.state === "active" || plan.state === "grace";

  return (
    <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
      <PageHeader
        eyebrow="Settings"
        title="Plan & billing"
        sub="Pick the plan that matches how you sell. Prices are set for your country and billed through Paystack — upgrade any time; downgrades and cancellations take effect at the end of your paid period."
      />

      <div className="grid gap-4">
        <Suspense fallback={null}>
          <SubscriptionVerifier />
        </Suspense>

        {feedback.error ? (
          <div
            className="rounded-[12px] border border-[#F2C9BF] bg-[#FBEAE7] px-4 py-3 text-[13px] font-semibold text-[#B42318]"
            role="alert"
          >
            {feedback.error}
          </div>
        ) : null}
        {feedback.payment === "confirmed" ? (
          <div
            className="rounded-[12px] border border-[#BFE3D2] bg-[#E7F4EE] px-4 py-3 text-[13px] font-semibold text-success"
            role="status"
          >
            Payment confirmed — your plan is active. Welcome aboard!
          </div>
        ) : null}

        {/* Current plan */}
        <Panel className="p-4.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                Current plan
              </p>
              <div className="mt-1 flex items-center gap-2">
                <h2 className="font-serif text-[22px] font-medium text-ink">{plan.planName}</h2>
                <Badge tone={STATE_TONE[plan.state] ?? "neutral"}>
                  {plan.state === "free" ? "Free" : plan.state.replace("_", " ")}
                </Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-soft">
                {plan.state === "free"
                  ? "Core selling is always free — storefront, Paystack payments, orders and share links."
                  : renewsAt
                    ? `Renews on ${renewsAt}.`
                    : "Billing is managed by Paystack."}
              </p>
              {plan.graceEndsAt ? (
                <p className="mt-1 text-[12.5px] font-semibold text-warn">
                  Payment issue — features stay on until{" "}
                  {new Date(plan.graceEndsAt).toLocaleDateString()} while we retry.
                </p>
              ) : null}
              {subscription && plan.state === "free" && subscribedPlan?.name ? (
                <p className="mt-1 text-[12.5px] text-ink-muted">
                  Your {subscribedPlan.name} subscription is {subscription.state.replace("_", " ")} —
                  resubscribe below to restore its features.
                </p>
              ) : null}
              {pendingLabel ? (
                <p className="mt-1 text-[12.5px] font-semibold text-ink-muted">{pendingLabel}</p>
              ) : null}
            </div>
            {isEntitled && !subscription?.pending_change_type ? (
              <form action={cancelSubscription}>
                <button
                  type="submit"
                  className="min-h-10 cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-danger transition-colors hover:border-danger"
                >
                  Cancel renewal
                </button>
              </form>
            ) : null}
          </div>
        </Panel>

        {/* Plan cards */}
        <div className="grid items-start gap-4 md:grid-cols-3">
          {ordered.map((row) => {
            const isCurrent = plan.planCode === row.code;
            const prices = row.plan_prices.filter(
              (price) => price.country === actor.country && price.active && price.amount_minor > 0,
            );
            const monthly = prices.find((price) => price.interval === "monthly");
            const yearly = prices.find((price) => price.interval === "yearly");
            const featured = row.code === "growth";
            const isUpgradeTarget = row.code !== "free" && (!isEntitled || TIER[row.code] > TIER[plan.planCode]);
            const isPendingThisRow =
              row.code === "free"
                ? subscription?.pending_change_type === "cancel"
                : subscription?.pending_change_type === "downgrade" && pendingPlanName === row.name;
            return (
              <Panel
                key={row.code}
                className={`p-4.5 ${featured ? "border-accent shadow-[0_10px_30px_rgba(168,67,26,0.08)]" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-serif text-[19px] font-medium text-ink">{row.name}</h3>
                  {isCurrent ? (
                    <Badge tone="accent">Current</Badge>
                  ) : featured ? (
                    <Badge tone="dark">Popular</Badge>
                  ) : null}
                </div>

                <p className="mt-2 min-h-[42px]">
                  {row.code === "free" ? (
                    <span className="font-serif text-[24px] font-medium text-ink">Free</span>
                  ) : monthly ? (
                    <>
                      <span className="font-serif text-[24px] font-medium text-ink">
                        {formatMoney(monthly.amount_minor, monthly.currency as CurrencyCode)}
                      </span>
                      <span className="text-[12.5px] text-ink-muted"> / month</span>
                      {yearly ? (
                        <span className="block text-[11.5px] text-ink-muted">
                          or {formatMoney(yearly.amount_minor, yearly.currency as CurrencyCode)} / year
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-[13px] font-semibold text-warn">
                      Not priced for your country yet
                    </span>
                  )}
                </p>

                <ul className="mt-3 grid list-none gap-1.5 p-0">
                  {featureBullets(row.entitlements).map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2 text-[12.5px] text-ink-soft">
                      <span aria-hidden="true" className="mt-0.5 font-bold text-success">
                        ✓
                      </span>
                      {bullet}
                    </li>
                  ))}
                </ul>

                <div className="mt-4">
                  {isCurrent ? (
                    <p className="grid min-h-11 place-items-center rounded-[10px] bg-line-soft text-[13px] font-bold text-ink-muted">
                      Your plan
                    </p>
                  ) : isPendingThisRow ? (
                    <p className="text-[12px] text-ink-muted">{pendingLabel}</p>
                  ) : row.code === "free" ? (
                    isEntitled ? (
                      <form action={changePlan}>
                        <input name="planCode" type="hidden" value="free" />
                        <button
                          type="submit"
                          className="min-h-11 w-full cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13.5px] font-bold text-ink transition-colors hover:border-[#B9AC98]"
                        >
                          Switch to Free — takes effect {renewsAt ?? "at period end"}
                        </button>
                      </form>
                    ) : (
                      <p className="text-[12px] text-ink-muted">Free is always available — no billing required.</p>
                    )
                  ) : prices.length > 0 ? (
                    <form action={changePlan} className="grid gap-2.5">
                      <input name="planCode" type="hidden" value={row.code} />
                      {isUpgradeTarget ? (
                        <label className="grid gap-1 text-[12px] font-semibold text-ink-soft">
                          Billing interval
                          <select
                            name="interval"
                            className="min-h-10 rounded-[10px] border border-line-input bg-white px-3 text-[13px] text-ink"
                            defaultValue="monthly"
                          >
                            <option value="monthly">Monthly</option>
                            {yearly ? <option value="yearly">Yearly (2 months free)</option> : null}
                          </select>
                        </label>
                      ) : null}
                      <button
                        type="submit"
                        className={`min-h-11 cursor-pointer rounded-[10px] px-4 text-[13.5px] font-bold transition-colors ${
                          featured
                            ? "border-none bg-accent text-white hover:bg-accent-deep"
                            : "border border-line-strong bg-white text-ink hover:border-[#B9AC98]"
                        }`}
                      >
                        {isUpgradeTarget ? `Upgrade to ${row.name}` : `Switch to ${row.name} — takes effect ${renewsAt ?? "at period end"}`}
                      </button>
                    </form>
                  ) : (
                    <p className="grid min-h-11 place-items-center rounded-[10px] bg-line-soft text-[13px] font-bold text-ink-muted">
                      Coming to your market soon
                    </p>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>

        <p className="text-[12px] text-ink-muted">
          Payments are processed by Paystack. Upgrades take effect immediately after payment;
          downgrades and cancellations keep your current features until the end of the paid period.
          Manage plan pricing questions with{" "}
          <Link
            href="/dashboard/orders"
            className="font-semibold text-accent no-underline hover:text-accent-deep"
          >
            support
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 3: Manually verify in the browser**

Run: `pnpm dev:local`, log in as a seller with an active Growth subscription (set one up via the Task 5 flow or directly in the DB for a quick check), open `/dashboard/settings/billing`.
Expected: the Scale card shows "Upgrade to Scale" (with an interval selector); the Free card shows a real "Switch to Free — takes effect [date]" button (not the old static paragraph); after clicking it, the Current Plan panel shows "Switching to Free on [date]" and the Free/Growth cards no longer show duplicate action buttons for the already-scheduled change.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(seller\)/dashboard/settings/billing/page.tsx
git commit -m "feat: show scheduled plan changes and wire real downgrade/cancel buttons"
```

---

### Task 7: Daily cron — apply pending plan changes

**Files:**
- Create: `src/app/api/internal/billing/apply-plan-changes/route.ts`
- Create: `src/app/api/internal/billing/apply-plan-changes/route.test.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `isInternalJobRequest` from `@/lib/internal-jobs/auth`, `createSubscriptionForAuthorization` from Task 2, `createAdminClient`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/internal/billing/apply-plan-changes/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isInternalJobRequest: vi.fn(),
  createAdminClient: vi.fn(),
  createPlan: vi.fn(),
  createSubscriptionForAuthorization: vi.fn(),
}));

vi.mock("@/lib/internal-jobs/auth", () => ({ isInternalJobRequest: mocks.isInternalJobRequest }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/payments/paystack", () => ({
  paystackProvider: () => ({
    createPlan: mocks.createPlan,
    createSubscriptionForAuthorization: mocks.createSubscriptionForAuthorization,
  }),
}));

import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/internal/billing/apply-plan-changes", { method: "POST" });
}

/** A minimal chainable Supabase query-builder mock, table-keyed. */
function adminMock(tables: Record<string, { select?: unknown; update?: (payload: unknown) => unknown }>) {
  return {
    from: (table: string) => {
      const t = tables[table] ?? {};
      return {
        select: () => ({
          not: () => ({ lte: () => Promise.resolve({ data: t.select }) }),
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: t.select }) }),
        }),
        update: (payload: unknown) => ({
          eq: () => ({ eq: () => Promise.resolve({ data: t.update ? t.update(payload) : null }) }),
        }),
      };
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/internal/billing/apply-plan-changes", () => {
  it("rejects unauthorized requests", async () => {
    mocks.isInternalJobRequest.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(401);
  });

  it("applies a due cancel: sets state to cancelled and clears pending fields", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        seller_subscriptions: {
          select: [{ id: "sub-1", pending_change_type: "cancel", pending_plan_id: null, pending_plan_version: null, pending_price_id: null, provider_authorization_code: null, provider_customer_code: null }],
          update: updateSpy,
        },
      }),
    );
    const response = await POST(request());
    const body = await response.json();
    expect(body.applied).toBe(1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "cancelled", pending_change_type: null }));
  });

  it("falls back to cancelled when a due downgrade has no stored authorization", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        seller_subscriptions: {
          select: [{ id: "sub-1", pending_change_type: "downgrade", pending_plan_id: "p1", pending_plan_version: 1, pending_price_id: "pr1", provider_authorization_code: null, provider_customer_code: null }],
          update: updateSpy,
        },
      }),
    );
    const response = await POST(request());
    const body = await response.json();
    expect(body.failed).toBe(1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "cancelled" }));
    expect(mocks.createSubscriptionForAuthorization).not.toHaveBeenCalled();
  });

  it("applies a due downgrade with a stored authorization", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    const updateSpy = vi.fn();
    mocks.createSubscriptionForAuthorization.mockResolvedValue({ subscriptionCode: "SUB_new", emailToken: "tok_new" });
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        seller_subscriptions: {
          select: [{ id: "sub-1", pending_change_type: "downgrade", pending_plan_id: "p1", pending_plan_version: 1, pending_price_id: "pr1", provider_authorization_code: "AUTH_1", provider_customer_code: "CUS_1" }],
          update: updateSpy,
        },
        plan_prices: {
          select: { id: "pr1", amount_minor: 6000, currency: "GHS", interval: "monthly", provider_plan_code: "PLN_growth", plans: { name: "Growth" } },
        },
      }),
    );
    const response = await POST(request());
    const body = await response.json();
    expect(body.applied).toBe(1);
    expect(mocks.createSubscriptionForAuthorization).toHaveBeenCalledWith({
      customerCode: "CUS_1", planCode: "PLN_growth", authorizationCode: "AUTH_1",
    });
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "active", plan_id: "p1", pending_change_type: null }));
  });

  it("re-invoking after a row was already applied is a no-op", async () => {
    mocks.isInternalJobRequest.mockReturnValue(true);
    mocks.createAdminClient.mockReturnValue(adminMock({ seller_subscriptions: { select: [] } }));
    const response = await POST(request());
    const body = await response.json();
    expect(body).toEqual({ applied: 0, failed: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/api/internal/billing/apply-plan-changes/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/internal/billing/apply-plan-changes/route.ts
import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

function periodEnd(start: Date, interval: string): string {
  const end = new Date(start);
  if (interval === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end.toISOString();
}

/**
 * Applies scheduled downgrades/cancellations once current_period_end has
 * passed. changePlan disables the seller's old Paystack subscription
 * immediately (so it stops renewing) but leaves entitlements untouched
 * until this cron runs — the seller keeps what they paid for. Safe to
 * re-invoke: a row only matches the initial query while pending_change_type
 * is still set, so an already-applied row is naturally skipped on rerun. A
 * failed downgrade leaves pending_change_type set so the next run retries.
 */
export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  const now = new Date();
  const { data: due } = await admin
    .from("seller_subscriptions")
    .select(
      "id,pending_change_type,pending_plan_id,pending_plan_version,pending_price_id,provider_authorization_code,provider_customer_code",
    )
    .not("pending_change_type", "is", null)
    .lte("current_period_end", now.toISOString());

  let applied = 0;
  let failed = 0;

  for (const row of due ?? []) {
    if (row.pending_change_type === "cancel") {
      await admin
        .from("seller_subscriptions")
        .update({
          state: "cancelled",
          cancelled_at: now.toISOString(),
          pending_change_type: null,
          pending_plan_id: null,
          pending_plan_version: null,
          pending_price_id: null,
        })
        .eq("id", row.id)
        .eq("pending_change_type", "cancel");
      applied += 1;
      continue;
    }

    if (!row.provider_authorization_code || !row.provider_customer_code) {
      // No stored card to charge headlessly — fail safe to Free rather than
      // silently not billing.
      await admin
        .from("seller_subscriptions")
        .update({
          state: "cancelled",
          cancelled_at: now.toISOString(),
          pending_change_type: null,
          pending_plan_id: null,
          pending_plan_version: null,
          pending_price_id: null,
        })
        .eq("id", row.id)
        .eq("pending_change_type", "downgrade");
      failed += 1;
      continue;
    }

    const { data: price } = await admin
      .from("plan_prices")
      .select("id,amount_minor,currency,interval,provider_plan_code,plans(name)")
      .eq("id", row.pending_price_id)
      .maybeSingle();
    if (!price) {
      failed += 1;
      continue;
    }

    let providerPlanCode = price.provider_plan_code;
    if (!providerPlanCode) {
      try {
        const planRow = price.plans as { name?: string } | { name?: string }[] | null;
        const planName = Array.isArray(planRow) ? planRow[0]?.name : planRow?.name;
        const created = await paystackProvider().createPlan({
          name: `SnapDuka ${planName ?? "plan"} (${price.currency} ${price.interval})`,
          interval: price.interval === "yearly" ? "annually" : "monthly",
          amountMinor: price.amount_minor,
          currency: price.currency,
        });
        providerPlanCode = created.planCode;
        await admin.from("plan_prices").update({ provider_plan_code: providerPlanCode }).eq("id", price.id);
      } catch {
        failed += 1;
        continue;
      }
    }

    try {
      const subscription = await paystackProvider().createSubscriptionForAuthorization({
        customerCode: row.provider_customer_code,
        planCode: providerPlanCode,
        authorizationCode: row.provider_authorization_code,
      });
      await admin
        .from("seller_subscriptions")
        .update({
          plan_id: row.pending_plan_id,
          plan_version: row.pending_plan_version,
          price_id: row.pending_price_id,
          state: "active",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd(now, price.interval),
          provider_subscription_code: subscription.subscriptionCode,
          provider_email_token: subscription.emailToken,
          pending_change_type: null,
          pending_plan_id: null,
          pending_plan_version: null,
          pending_price_id: null,
        })
        .eq("id", row.id)
        .eq("pending_change_type", "downgrade");
      applied += 1;
    } catch {
      failed += 1;
      // pending_change_type left set on the row — retried on the next run.
    }
  }

  return NextResponse.json({ applied, failed, total: due?.length ?? 0 });
}

export const GET = POST;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/app/api/internal/billing/apply-plan-changes/route.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Register the cron in `vercel.json`**

Change:

```json
{
  "crons": [
    { "path": "/api/internal/discovery/refresh", "schedule": "30 3 * * *" }
  ]
}
```

to:

```json
{
  "crons": [
    { "path": "/api/internal/discovery/refresh", "schedule": "30 3 * * *" },
    { "path": "/api/internal/billing/apply-plan-changes", "schedule": "15 3 * * *" }
  ]
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/internal/billing/apply-plan-changes/route.ts src/app/api/internal/billing/apply-plan-changes/route.test.ts vercel.json
git commit -m "feat: add daily cron to apply scheduled plan downgrades and cancellations"
```

---

### Task 8: Full verification pass

**Files:** none — this task runs checks across everything built in Tasks 1–7.

- [ ] **Step 1: Run the full automated test suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: typecheck clean, lint clean, all vitest suites pass (including the new `paystack.test.ts` additions, `billing/actions.test.ts`, and `apply-plan-changes/route.test.ts`).

- [ ] **Step 2: Run the pgTAP suite**

Run: `pnpm db:reset && pnpm db:test`
Expected: `013_billing_plan_changes.test.sql .. ok`; no new failures beyond the known pre-existing, unrelated `001_core.test.sql` plan-versioning issue.

- [ ] **Step 3: Manual end-to-end pass on local dev**

Run: `pnpm dev:local`. As a seller with `PAYSTACK_SECRET_KEY` set to a Paystack **test** key:
1. Subscribe to Growth. Confirm checkout completes and the billing page shows Growth as current.
2. Click "Upgrade to Scale." Confirm: the old Growth Paystack subscription is disabled (check the Paystack test dashboard), a new Scale checkout starts, and after completing it the billing page shows Scale as current with a fresh renewal date.
3. Click "Switch to Growth — takes effect [date]" on the Scale page. Confirm: no new checkout starts, the Current Plan panel shows "Switching to Growth on [date]", and the seller still has Scale-level entitlements (check a Scale-only feature still works).
4. Directly in the local DB, set that subscription's `current_period_end` to a past timestamp (`update seller_subscriptions set current_period_end = now() - interval '1 day' where seller_account_id = '<id>';`).
5. Manually invoke the cron: `curl -X POST http://localhost:3000/api/internal/billing/apply-plan-changes -H "Authorization: Bearer $INTERNAL_JOB_SECRET"`. Confirm the response shows `applied: 1`, and the billing page now shows Growth as current with a fresh period.
6. Re-invoke the same curl command. Confirm the response shows `applied: 0, total: 0` — no double-application.
7. Repeat steps 1–2 for a Growth→Free cancellation, confirming the seller keeps Growth features until you manually expire `current_period_end` and re-run the cron, at which point they drop to Free.

- [ ] **Step 4: Report results**

No commit for this task — it's verification only. If any check fails, return to the relevant task above and fix before considering the plan complete.
