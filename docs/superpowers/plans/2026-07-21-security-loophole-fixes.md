# Security Loophole Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 11 security/correctness findings from the 2026-07-21 audit (2 Critical, 8 Important, 1 Minor): a cross-tenant stock-lock RPC, a rate limiter that doesn't work across serverless instances, an unscoped push-subscription policy, an operator-only support-note leak, missing role checks on team-writable actions, a suspended-seller bypass, stock reservations that are never released, refund status that never reflects reality, a checkout RPC that bypasses rate limiting, overly-broad secret-column grants, and an untrimmed-URL storage bug.

**Architecture:** Each finding gets its own task with an isolated migration/code change and its own test. The rate-limiter fix (Task 1) is foundational — it replaces the in-memory `Map` with a Postgres-backed counter (chosen over Upstash Redis to avoid a new external dependency), and every other rate-limited call site in the app must be updated to `await` it in the same task, since a half-migrated state would silently make the (now-async) function always appear "blocked" wherever `await` is missing.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS + plpgsql), Zod, Vitest, pgTAP.

## Global Constraints

- Every migration is additive/corrective only — no existing table is dropped, no unrelated behavior changes.
- `reserve_product_stock`/`create_guest_order`'s internal callers (`create_guest_order` itself, `create_guest_order_growth`) must keep working exactly as before — only the *direct*, external RPC grant to `anon`/`authenticated` is revoked. Function-to-function calls run under the definer's own privileges and are unaffected by revoking a caller-role grant.
- `finish_stock_reservation` is idempotent (a no-op when the reservation is no longer `'active'`) — new call sites may call it defensively without checking payment method or prior state first.
- The rate limiter must **fail open** (allow the request) on a database error, not fail closed — an RPC hiccup must not turn into a full outage of login/checkout for legitimate users. This is a deliberate, disclosed tradeoff, not an oversight.
- No task touches `checkout-form.tsx`/`purchase-actions.tsx` (buyer-facing checkout price display) — out of scope, unaffected by any of these findings.

---

### Task 1: Postgres-backed rate limiter (replaces the ineffective in-memory one)

**Files:**
- Create: `supabase/migrations/202607210037_rate_limit_counters.sql`
- Create: `supabase/tests/database/018_rate_limit_counters.test.sql`
- Modify: `src/lib/rate-limit.ts`
- Modify: `src/lib/rate-limit.test.ts`
- Modify: `src/app/(auth)/login/actions.ts` (add `await` to all 6 existing calls — do NOT add the new per-identifier verify check yet, that's Task 2)
- Modify: `src/app/(auth)/login/actions.test.ts` (mock return values become resolved values)
- Modify: `src/app/api/payments/paystack/verify/route.ts`
- Modify: `src/app/api/payments/paystack/initialize/route.ts`
- Modify: `src/app/api/payments/paystack/subscription-verify/route.ts`
- Modify: `src/app/api/checkout/abandoned/route.ts`
- Modify: `src/app/api/checkout/orders/route.ts`
- Modify: `src/app/api/checkout/quote/route.ts`
- Modify: `src/app/api/checkout/quote/route.test.ts`
- Modify: `src/app/api/restock/route.ts`
- Modify: `src/app/api/restock/route.test.ts`
- Modify: `src/app/api/analytics/events/route.ts`
- Modify: `src/app/api/analytics/events/route.test.ts`

**Interfaces:**
- Produces: `checkRateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult>` — now async (was sync). `RateLimitConfig`/`RateLimitResult` types are unchanged. Every caller in the codebase must `await` it.
- Consumes: `createAdminClient` from `@/lib/supabase/admin` (internally, callers don't need to pass a client).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/202607210037_rate_limit_counters.sql
-- Replaces the app's in-memory rate limiter (a bare process-local Map,
-- which resets per Vercel serverless instance and provides no real
-- protection under concurrent load) with a Postgres-backed counter shared
-- across every instance.

create table public.rate_limit_counters (
  key text primary key,
  count integer not null default 1,
  reset_at timestamptz not null
);

alter table public.rate_limit_counters enable row level security;
alter table public.rate_limit_counters force row level security;

create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_ms bigint)
returns table(allowed boolean, retry_after_ms bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_ts timestamptz := clock_timestamp();
  row_record public.rate_limit_counters%rowtype;
begin
  insert into public.rate_limit_counters (key, count, reset_at)
  values (p_key, 1, now_ts + (p_window_ms::text || ' milliseconds')::interval)
  on conflict (key) do update set
    count = case when public.rate_limit_counters.reset_at <= now_ts then 1 else public.rate_limit_counters.count + 1 end,
    reset_at = case when public.rate_limit_counters.reset_at <= now_ts then now_ts + (p_window_ms::text || ' milliseconds')::interval else public.rate_limit_counters.reset_at end
  returning * into row_record;

  if row_record.count > p_limit then
    return query select false, greatest(0, extract(epoch from (row_record.reset_at - now_ts)) * 1000)::bigint;
  else
    return query select true, 0::bigint;
  end if;
end;
$$;

grant execute on function public.check_rate_limit(text, integer, bigint) to service_role;
```

- [ ] **Step 2: Write the pgTAP test**

```sql
-- supabase/tests/database/018_rate_limit_counters.test.sql
begin;

set local search_path = extensions, public;

select plan(6);

select has_table('public', 'rate_limit_counters', 'rate_limit_counters table exists');
select has_function('public', 'check_rate_limit', array['text','integer','bigint'], 'check_rate_limit function exists');

-- Allows up to the limit.
select is(
  (select allowed from public.check_rate_limit('rl-test-a', 3, 60000)),
  true,
  'first request within a fresh window is allowed'
);
select is(
  (select allowed from public.check_rate_limit('rl-test-a', 3, 60000)),
  true,
  'second request within the limit is allowed'
);
select is(
  (select count(*)::int from (
    select allowed from public.check_rate_limit('rl-test-a', 3, 60000)
    union all
    select allowed from public.check_rate_limit('rl-test-a', 3, 60000)
  ) t where allowed = false),
  1,
  'the 5th call against a limit of 3 (3 already made above) is blocked'
);

-- A different key is a fresh counter, unaffected by rl-test-a's state.
select is(
  (select allowed from public.check_rate_limit('rl-test-b', 1, 60000)),
  true,
  'a different key gets its own independent counter'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run migration and pgTAP test**

Run: `pnpm db:reset && pnpm db:test`
Expected: `018_rate_limit_counters.test.sql .. ok`; only the known pre-existing unrelated `001_core.test.sql` plan-versioning failure remains.

- [ ] **Step 4: Rewrite `src/lib/rate-limit.ts`**

Replace the whole file:

```ts
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Postgres-backed sliding-window rate limiter.
 *
 * Backed by a `rate_limit_counters` table + `check_rate_limit` RPC, so
 * counters are shared across every serverless instance — the prior
 * in-memory Map reset per Vercel instance under concurrent load, making
 * every limit in the app (OTP, checkout, Paystack, analytics, restock)
 * trivially bypassable by a deliberate attacker.
 */

export type RateLimitConfig = {
  /** Maximum number of requests allowed within the window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

/**
 * Check and increment the rate-limit counter for `key`.
 * Returns `{ ok: true }` when the request is allowed,
 * or `{ ok: false, retryAfterMs }` when the limit is exceeded.
 *
 * Fails open on a database error — a transient RPC failure must not turn
 * into a full outage of login/checkout for every legitimate user.
 */
export async function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitConfig,
): Promise<RateLimitResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
  });
  if (error || !data || data.length === 0) {
    return { ok: true };
  }
  const [{ allowed, retry_after_ms }] = data;
  return allowed ? { ok: true } : { ok: false, retryAfterMs: Number(retry_after_ms) };
}
```

- [ ] **Step 5: Rewrite `src/lib/rate-limit.test.ts`**

Replace the whole file:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  afterEach(() => vi.clearAllMocks());

  it("calls check_rate_limit with the key, limit, and window", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ allowed: true, retry_after_ms: 0 }], error: null });
    const result = await checkRateLimit("test-key", { limit: 5, windowMs: 60_000 });
    expect(result).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("check_rate_limit", { p_key: "test-key", p_limit: 5, p_window_ms: 60_000 });
  });

  it("returns ok:false with retryAfterMs when the RPC reports the limit exceeded", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ allowed: false, retry_after_ms: 12_345 }], error: null });
    const result = await checkRateLimit("test-key", { limit: 5, windowMs: 60_000 });
    expect(result).toEqual({ ok: false, retryAfterMs: 12_345 });
  });

  it("fails open when the RPC errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("connection refused") });
    const result = await checkRateLimit("test-key", { limit: 5, windowMs: 60_000 });
    expect(result).toEqual({ ok: true });
  });

  it("fails open when the RPC returns no rows", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const result = await checkRateLimit("test-key", { limit: 5, windowMs: 60_000 });
    expect(result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 6: Add `await` to every call site**

In `src/app/(auth)/login/actions.ts`, change every `checkRateLimit(...)` call to `await checkRateLimit(...)` — lines 94, 105, 134, 165, 176, 204 (the variable being assigned, e.g. `const rl = checkRateLimit(...)`, becomes `const rl = await checkRateLimit(...)`). Do not change anything else in this file in this task.

In each of these files, change the rate-limit call to `await` it (each currently reads `checkRateLimit(...)` either assigned to a variable or inline in an `if`):

- `src/app/api/payments/paystack/verify/route.ts` line 20: `const rl = checkRateLimit(...)` → `const rl = await checkRateLimit(...)`
- `src/app/api/payments/paystack/initialize/route.ts` line 25: same change
- `src/app/api/payments/paystack/subscription-verify/route.ts` line 30: same change
- `src/app/api/checkout/abandoned/route.ts` line 11: `if (!checkRateLimit(...).ok)` → `if (!(await checkRateLimit(...)).ok)`
- `src/app/api/checkout/orders/route.ts` line 22: `const rl = checkRateLimit(...)` → `const rl = await checkRateLimit(...)`
- `src/app/api/checkout/quote/route.ts` line 19: `if (!checkRateLimit(...).ok)` → `if (!(await checkRateLimit(...)).ok)`
- `src/app/api/restock/route.ts` line 17: `if (!checkRateLimit(...).ok)` → `if (!(await checkRateLimit(...)).ok)`
- `src/app/api/analytics/events/route.ts` line 17: `if (!checkRateLimit(...).ok)` → `if (!(await checkRateLimit(...)).ok)`

- [ ] **Step 7: Update test mocks in the 4 files that mock `checkRateLimit`**

In `src/app/(auth)/login/actions.test.ts`: every `mocks.checkRateLimit.mockReturnValue(...)` becomes `mocks.checkRateLimit.mockResolvedValue(...)` (lines 37, 84, 179, 205), and every `mocks.checkRateLimit.mockImplementation((key: string): RateLimitResult => {...})` (lines 97, 215) becomes `mocks.checkRateLimit.mockImplementation(async (key: string): Promise<RateLimitResult> => {...})`. Also change the type annotation at line 10 from `vi.fn<(key: string) => RateLimitResult>(...)` to `vi.fn<(key: string) => Promise<RateLimitResult>>(...)`.

In `src/app/api/checkout/quote/route.test.ts` line 20: `mocks.checkRateLimit.mockReturnValue({ ok: true });` → `mocks.checkRateLimit.mockResolvedValue({ ok: true });`; line 25: same change for the `{ ok: false, retryAfterMs: 5_000 }` case.

In `src/app/api/restock/route.test.ts` line 35: `mocks.checkRateLimit.mockReturnValue({ ok: true });` → `mocks.checkRateLimit.mockResolvedValue({ ok: true });`.

In `src/app/api/analytics/events/route.test.ts` line 20: `mocks.checkRateLimit.mockReturnValue({ ok: true });` → `mocks.checkRateLimit.mockResolvedValue({ ok: true });`; line 25: same change for the `{ ok: false, retryAfterMs: 1_000 }` case.

- [ ] **Step 8: Run the affected test suites**

Run: `pnpm vitest run src/lib/rate-limit.test.ts "src/app/(auth)/login/actions.test.ts" src/app/api/checkout/quote/route.test.ts src/app/api/restock/route.test.ts src/app/api/analytics/events/route.test.ts`
Expected: all pass.

- [ ] **Step 9: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all clean. Typecheck will catch any call site where `await` was missed (the result would be used as `Promise<RateLimitResult>` where `RateLimitResult` — specifically `.ok`/`.retryAfterMs` — is expected, a type error).

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/202607210037_rate_limit_counters.sql supabase/tests/database/018_rate_limit_counters.test.sql src/lib/rate-limit.ts src/lib/rate-limit.test.ts "src/app/(auth)/login/actions.ts" "src/app/(auth)/login/actions.test.ts" src/app/api/payments/paystack/verify/route.ts src/app/api/payments/paystack/initialize/route.ts src/app/api/payments/paystack/subscription-verify/route.ts src/app/api/checkout/abandoned/route.ts src/app/api/checkout/orders/route.ts src/app/api/checkout/quote/route.ts src/app/api/checkout/quote/route.test.ts src/app/api/restock/route.ts src/app/api/restock/route.test.ts src/app/api/analytics/events/route.ts src/app/api/analytics/events/route.test.ts
git commit -m "fix: replace the in-memory rate limiter with a Postgres-backed one shared across serverless instances"
```

---

### Task 2: Per-identifier OTP verify rate limit (closes the brute-force gap)

**Files:**
- Modify: `src/app/(auth)/login/actions.ts`
- Modify: `src/app/(auth)/login/actions.test.ts`

**Interfaces:**
- Consumes: `checkRateLimit` (now async, from Task 1).

- [ ] **Step 1: Write the failing test**

Read the existing test file's conventions around lines 84-115 (the existing `verifyOtpAction` rate-limit test) first, then add:

```ts
// append inside the existing describe block for verifyOtpAction in src/app/(auth)/login/actions.test.ts
it("rate-limits verification attempts per target identifier, independent of IP", async () => {
  mocks.checkRateLimit.mockImplementation(async (key: string): Promise<RateLimitResult> => {
    if (key.startsWith("auth:verify-otp:target:")) return { ok: false, retryAfterMs: 45_000 };
    return { ok: true };
  });

  await expect(
    verifyOtpAction(formData({ identifier: "user@example.com", code: "123456", next: "/dashboard" })),
  ).rejects.toThrow();

  expect(mocks.checkRateLimit).toHaveBeenCalledWith(
    "auth:verify-otp:target:user@example.com",
    expect.objectContaining({ limit: expect.any(Number), windowMs: expect.any(Number) }),
  );
});
```

(Match this test's exact `formData`/redirect-throws-via-`next/navigation`-mock conventions to whatever the existing tests in this same file already use — read the file's existing `verifyOtpAction` tests around lines 84-115 first and mirror their setup precisely, since `redirect()` is mocked to throw in this test suite.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run "src/app/(auth)/login/actions.test.ts"`
Expected: FAIL — no per-identifier verify check exists yet.

- [ ] **Step 3: Add the per-identifier check to `verifyOtpAction`**

Replace the `verifyOtpAction` function body:

```ts
export async function verifyOtpAction(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const rawIdentifier = formValue(formData, "identifier");
  const ip = await clientIp();

  const rl = await checkRateLimit(`auth:verify-otp:${ip}`, VERIFY_OTP_LIMIT);
  if (!rl.ok) {
    const waitSec = Math.ceil(rl.retryAfterMs / 1000);
    toCodeStep(rawIdentifier, next, "error", `Too many attempts. Try again in ${waitSec} seconds.`);
  }

  const identifier = classifyIdentifier(rawIdentifier);
  const parsedCode = codeSchema.safeParse(formValue(formData, "code").trim());

  if (identifier.kind === "invalid" || !parsedCode.success) {
    toCodeStep(rawIdentifier, next, "error", "Enter the 6-digit code.");
  }

  // Per-identifier limit, independent of requester IP — closes the gap where
  // an attacker could brute-force a known phone/email's OTP code by
  // distributing verify attempts across many IPs/serverless instances.
  const identifierRl = await checkRateLimit(`auth:verify-otp:target:${identifier.value}`, VERIFY_OTP_LIMIT);
  if (!identifierRl.ok) {
    const waitSec = Math.ceil(identifierRl.retryAfterMs / 1000);
    toCodeStep(identifier.value, next, "error", `Too many attempts. Try again in ${waitSec} seconds.`);
  }

  const supabase = await createClient();
  const { error } =
    identifier.kind === "email"
      ? await supabase.auth.verifyOtp({ email: identifier.value, token: parsedCode.data, type: "email" })
      : await supabase.auth.verifyOtp({ phone: identifier.value, token: parsedCode.data, type: "sms" });

  if (error) {
    toCodeStep(identifier.value, next, "error", "That code is invalid or has expired.");
  }

  redirect(next);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run "src/app/(auth)/login/actions.test.ts"`
Expected: PASS — new case and every pre-existing test in this file.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(auth)/login/actions.ts" "src/app/(auth)/login/actions.test.ts"
git commit -m "fix: rate-limit OTP verification attempts per target identifier, not just per IP"
```

---

### Task 3: Revoke direct RPC access to `reserve_product_stock` and `create_guest_order`

**Files:**
- Create: `supabase/migrations/202607210038_revoke_direct_stock_rpc_access.sql`
- Create: `supabase/tests/database/019_revoke_direct_stock_rpc_access.test.sql`

**Interfaces:**
- Consumes: none new. `create_guest_order_growth` (the only legitimate public entry point, already granted to `anon,authenticated`) is unaffected — internal function-to-function calls run under the definer's privileges regardless of the caller-role grants revoked here.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/202607210038_revoke_direct_stock_rpc_access.sql
-- reserve_product_stock has no ownership check by design (a buyer
-- legitimately reserves stock on a product they don't own, via
-- create_guest_order) — the actual bug was that it was directly callable
-- via PostgREST RPC by ANY authenticated user, letting a malicious seller
-- lock a competitor's stock indefinitely by calling it directly against a
-- rival's product_id. create_guest_order has the same problem: it's meant
-- to be called only via create_guest_order_growth (which adds promotion/
-- campaign handling and is the route the rate-limited checkout endpoint
-- actually calls), but its own direct grant let a caller bypass both the
-- promo wrapper and the Next.js route's rate limiting entirely.
--
-- Revoking the caller-role grant here does not affect internal calls —
-- create_guest_order_growth and create_guest_order both run as their
-- definer (the migration-owning role), which always has implicit execute
-- on functions it owns regardless of what's granted to authenticated/anon.

revoke execute on function public.reserve_product_stock(uuid, uuid, integer, text, timestamptz) from authenticated;
revoke execute on function public.create_guest_order(uuid, uuid, jsonb, jsonb, text, text) from anon, authenticated;
```

- [ ] **Step 2: Write the pgTAP test**

```sql
-- supabase/tests/database/019_revoke_direct_stock_rpc_access.test.sql
begin;

set local search_path = extensions, public;

select plan(3);

-- Confirm the direct grants are gone for both functions.
select throws_ok(
  $$ set local role authenticated; select public.reserve_product_stock(gen_random_uuid(), null, 1, 'test-ref', now() + interval '1 hour') $$,
  '42501',
  null,
  'authenticated cannot call reserve_product_stock directly'
);

select throws_ok(
  $$ set local role authenticated; select public.create_guest_order(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, '[]'::jsonb, 'test-key', 'cash_on_delivery') $$,
  '42501',
  null,
  'authenticated cannot call create_guest_order directly'
);

select throws_ok(
  $$ set local role anon; select public.create_guest_order(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, '[]'::jsonb, 'test-key-2', 'cash_on_delivery') $$,
  '42501',
  null,
  'anon cannot call create_guest_order directly'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run migration and test**

Run: `pnpm db:reset && pnpm db:test`
Expected: `019_revoke_direct_stock_rpc_access.test.sql .. ok`; only the known pre-existing `001_core.test.sql` failure remains. Also confirm no other pgTAP test broke — `005_orders.test.sql` and `006_growth_core.test.sql` (which likely exercise `create_guest_order`/`create_guest_order_growth` end-to-end) must still pass, proving the internal call chain still works.

- [ ] **Step 4: Manual verification**

Run `pnpm dev:local`, place a real guest checkout order end-to-end through the storefront UI, and confirm it still succeeds (proving `create_guest_order_growth` → `create_guest_order` → `reserve_product_stock` still works via the legitimate path).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607210038_revoke_direct_stock_rpc_access.sql supabase/tests/database/019_revoke_direct_stock_rpc_access.test.sql
git commit -m "fix: revoke direct RPC access to reserve_product_stock and create_guest_order"
```

---

### Task 4: Stock reservation lifecycle — finalize on payment/completion, release on cancellation, sweep expired ones

**Files:**
- Create: `supabase/migrations/202607210039_stock_reservation_lifecycle.sql`
- Create: `supabase/tests/database/020_stock_reservation_lifecycle.test.sql`
- Create: `src/app/api/internal/inventory/sweep-expired-reservations/route.ts`
- Modify: `src/app/(seller)/dashboard/orders/actions.ts`
- Create: `src/app/(seller)/dashboard/orders/actions.test.ts`
- Modify: `vercel.json`

**Interfaces:**
- Produces: `finalize_order_stock(p_order_id uuid, p_outcome text)` — a new Postgres function (`p_outcome` is `'consumed'` or `'released'`), consumed by `apply_paystack_success` internally and by `updateOrderAction`/`bulkOrderStatusAction` via `admin.rpc(...)`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/202607210039_stock_reservation_lifecycle.sql
-- reserve_product_stock creates a stock_reservations row on every checkout
-- attempt, but nothing ever called finish_stock_reservation to consume or
-- release it — every abandoned cart or failed payment permanently locked
-- that quantity out of availability math, and reservations never actually
-- expired in practice even though they carry an expires_at.

create or replace function public.finalize_order_stock(p_order_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  reservation_id_var uuid;
begin
  if p_outcome not in ('consumed', 'released') then
    raise exception using errcode = '22023', message = 'Invalid stock finalization outcome.';
  end if;

  for reservation_id_var in
    select id from public.stock_reservations
    where reference like 'order:' || p_order_id::text || ':%' and status = 'active'
  loop
    perform public.finish_stock_reservation(reservation_id_var, p_outcome);
  end loop;
end;
$$;

grant execute on function public.finalize_order_stock(uuid, text) to service_role;

-- Finalize stock the moment a Paystack payment actually succeeds — this is
-- the same reference pattern create_guest_order uses when it reserves
-- stock ('order:<order_id>:<product_id>:<variant_id|base>'), so no new
-- column or link table is needed to find an order's reservations.
create or replace function public.apply_paystack_success(p_reference text,p_event_key text,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='' set row_security=off as $$
declare attempt public.payment_attempts%rowtype; order_record public.orders%rowtype;
begin
  insert into public.provider_events(provider,event_key,event_type,payload)
  values('paystack',p_event_key,'charge.success',p_payload) on conflict(provider,event_key) do nothing;
  if not found then return false; end if;
  select * into attempt from public.payment_attempts where reference=p_reference for update;
  if attempt.id is null then return false; end if;
  select * into order_record from public.orders where id=attempt.order_id for update;
  if (p_payload#>>'{data,status}') <> 'success'
    or (p_payload#>>'{data,amount}')::bigint <> order_record.total_minor
    or (p_payload#>>'{data,currency}') <> order_record.currency::text then
    update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
    return false;
  end if;
  update public.payment_attempts set status='paid',provider_data=p_payload->'data' where id=attempt.id;
  update public.orders set payment_status='paid',status=case when status='pending' then 'confirmed' else status end,event_version=event_version+1 where id=attempt.order_id;
  perform public.finalize_order_stock(attempt.order_id, 'consumed');
  insert into public.financial_events(order_id,event_type,amount_minor,currency,data)
  values(attempt.order_id,'payment_succeeded',order_record.total_minor,order_record.currency,jsonb_build_object('reference',p_reference));
  insert into public.order_events(order_id,seller_account_id,event_type,actor_type,data)
  values(attempt.order_id,attempt.seller_account_id,'payment_succeeded','provider',jsonb_build_object('reference',p_reference));
  update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
  return true;
end; $$;
```

- [ ] **Step 2: Write the pgTAP test**

Read `supabase/tests/database/005_orders.test.sql` first to match its exact fixture-seeding convention for a shop/product/fulfillment-method/guest order before writing this.

```sql
-- supabase/tests/database/020_stock_reservation_lifecycle.test.sql
begin;

set local search_path = extensions, public;

select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000020101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','stock-fixture@example.com','',now(),'{}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000020201','00000000-0000-0000-0000-000000020101','GH','active',true,'Stock Fixture Seller','stock-fixture@example.com','+233241234582');

insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('00000000-0000-0000-0000-000000020301','00000000-0000-0000-0000-000000020201','stock-fixture-shop','Stock Fixture Shop','Stock Fixture Shop Ltd','GH','GHS','published',now());

insert into public.products (id, shop_id, seller_account_id, name, slug, currency, price_minor, status, inventory_policy, stock_quantity, reserved_quantity)
values ('00000000-0000-0000-0000-000000020401','00000000-0000-0000-0000-000000020301','00000000-0000-0000-0000-000000020201','Stock Fixture Product','stock-fixture-product','GHS',5000,'active','track',10,0);

-- Reserve stock the same way create_guest_order does.
select public.reserve_product_stock(
  '00000000-0000-0000-0000-000000020401', null, 3,
  'order:00000000-0000-0000-0000-000000020501:00000000-0000-0000-0000-000000020401:base',
  now() + interval '30 minutes'
);

select is(
  (select reserved_quantity from public.products where id = '00000000-0000-0000-0000-000000020401'),
  3,
  'reserving stock increments reserved_quantity'
);

-- Finalize as consumed (simulating a successful payment) — reserved_quantity
-- drops back to 0 AND stock_quantity actually decrements.
select public.finalize_order_stock('00000000-0000-0000-0000-000000020501', 'consumed');

select is(
  (select reserved_quantity from public.products where id = '00000000-0000-0000-0000-000000020401'),
  0,
  'finalize_order_stock(consumed) releases the reservation hold'
);
select is(
  (select stock_quantity from public.products where id = '00000000-0000-0000-0000-000000020401'),
  7,
  'finalize_order_stock(consumed) actually decrements stock_quantity'
);

-- Calling it again is a safe no-op (finish_stock_reservation checks
-- status <> 'active' and returns early) — proves idempotency so calling
-- this from both apply_paystack_success and updateOrderAction is safe.
select lives_ok(
  $$ select public.finalize_order_stock('00000000-0000-0000-0000-000000020501', 'consumed') $$,
  'calling finalize_order_stock twice for the same order does not error'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run migration and pgTAP test**

Run: `pnpm db:reset && pnpm db:test`
Expected: `020_stock_reservation_lifecycle.test.sql .. ok`; only the known pre-existing `001_core.test.sql` failure remains.

- [ ] **Step 4: Create the expired-reservation sweep route**

```ts
// src/app/api/internal/inventory/sweep-expired-reservations/route.ts
import { NextResponse } from "next/server";

import { isInternalJobRequest } from "@/lib/internal-jobs/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  if (!isInternalJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: expired } = await admin
    .from("stock_reservations")
    .select("id")
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString())
    .limit(200);
  let released = 0;
  for (const row of expired ?? []) {
    const { error } = await admin.rpc("finish_stock_reservation", { p_reservation_id: row.id, p_outcome: "released" });
    if (!error) released++;
  }
  return NextResponse.json({ released, processed: expired?.length ?? 0 });
}

export const GET = POST;
```

- [ ] **Step 5: Add the cron schedule**

Read the current `vercel.json` and add a new entry to the `crons` array (keep the two existing entries unchanged):

```json
{
  "crons": [
    { "path": "/api/internal/discovery/refresh", "schedule": "30 3 * * *" },
    { "path": "/api/internal/billing/apply-plan-changes", "schedule": "15 3 * * *" },
    { "path": "/api/internal/inventory/sweep-expired-reservations", "schedule": "*/15 * * * *" }
  ]
}
```

- [ ] **Step 6: Fold in finding #6 and call the new RPC — update `orders/actions.ts`**

Read the current full file first (50 lines) to confirm it still matches what this plan assumes, then replace the whole file:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { canTransitionOrder, type OrderState } from "@/lib/commerce/transitions";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueIntegrationEvent } from "@/lib/integrations/events";

export async function updateOrderAction(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner","orders.manage") || !["pending","active"].includes(actor.status)) return;
  const orderId = String(formData.get("orderId") ?? "");
  const next = String(formData.get("status") ?? "") as OrderState;
  const version = Number(formData.get("version"));
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id,status,event_version,payment_status,customer_id,public_reference,total_minor,currency")
    .eq("id", orderId).eq("seller_account_id", actor.sellerAccountId).maybeSingle();
  if (!order || order.event_version !== version || !canTransitionOrder(order.status, next)) return;
  if (next === "completed" && order.payment_status === "offline_due" && formData.get("offlinePaid") !== "yes") return;
  const updates: Record<string, unknown> = { status: next, event_version: version + 1 };
  if (next === "confirmed") updates.fulfillment_status = "confirmed";
  if (next === "processing") updates.fulfillment_status = "preparing";
  if (next === "completed") {
    updates.fulfillment_status = "fulfilled";
    if (order.payment_status === "offline_due") updates.payment_status = "paid";
  }
  if (next === "cancelled") updates.fulfillment_status = "cancelled";
  const { data: changed } = await admin.from("orders").update(updates).eq("id", orderId).eq("event_version", version).select("id").maybeSingle();
  if (!changed) return;
  if (next === "completed") await admin.rpc("finalize_order_stock", { p_order_id: orderId, p_outcome: "consumed" });
  if (next === "cancelled") await admin.rpc("finalize_order_stock", { p_order_id: orderId, p_outcome: "released" });
  await admin.from("order_events").insert({ order_id: orderId, seller_account_id: actor.sellerAccountId, event_type: `order_${next}`, actor_type: "seller", actor_id: actor.sellerAccountId, data: { from: order.status, to: next } });
  await admin.rpc("enqueue_order_notification", { p_order_id: orderId, p_event: next });
  if (next === "completed") await enqueueIntegrationEvent({ data: { currency: order.currency, customerId: order.customer_id, orderId, reference: order.public_reference, totalMinor: order.total_minor }, eventId: `${orderId}:${version + 1}:completed`, eventType: "order.completed", sellerAccountId: actor.sellerAccountId });
  revalidatePath("/dashboard"); revalidatePath("/dashboard/orders"); revalidatePath(`/dashboard/orders/${orderId}`);
}

export async function bulkOrderStatusAction(formData: FormData) {
  const actor = await resolveServerActor();
  const ids = formData.getAll("orderIds").map(String).slice(0, 100);
  const next = String(formData.get("status")) as OrderState;
  if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner","orders.manage") || !["pending","active"].includes(actor.status) || !ids.length || !["confirmed","processing","completed","cancelled"].includes(next)) return;
  const admin = createAdminClient();
  const { data: orders } = await admin.from("orders").select("id,status,event_version,payment_status").eq("seller_account_id", actor.sellerAccountId).in("id", ids);
  for (const order of orders ?? []) {
    if (!canTransitionOrder(order.status, next) || (next === "completed" && order.payment_status === "offline_due")) continue;
    const { data: changed } = await admin.from("orders").update({ status: next, event_version: order.event_version + 1 }).eq("id", order.id).eq("event_version", order.event_version).select("id").maybeSingle();
    if (!changed) continue;
    if (next === "completed") await admin.rpc("finalize_order_stock", { p_order_id: order.id, p_outcome: "consumed" });
    if (next === "cancelled") await admin.rpc("finalize_order_stock", { p_order_id: order.id, p_outcome: "released" });
  }
  revalidatePath("/dashboard/orders");
}
```

(This adds the missing `actor.status` check — finding #6 — to `bulkOrderStatusAction`, matching `updateOrderAction`'s existing guard, and calls the new `finalize_order_stock` RPC from both actions on `completed`/`cancelled`. Also changed the bulk-update loop to check whether the row actually changed before calling the RPC, mirroring `updateOrderAction`'s own `if (!changed) return;` pattern, since an unmatched `event_version` means the update was a no-op.)

- [ ] **Step 7: Write the test file (new — no test existed for this file before)**

```ts
// src/app/(seller)/dashboard/orders/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  canTransitionOrder: vi.fn(),
  enqueueIntegrationEvent: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/commerce/transitions", () => ({ canTransitionOrder: mocks.canTransitionOrder }));
vi.mock("@/lib/integrations/events", () => ({ enqueueIntegrationEvent: mocks.enqueueIntegrationEvent }));

import { bulkOrderStatusAction } from "./actions";

function formData(values: Record<string, string | string[]>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((v) => data.append(key, v));
    else data.set(key, value);
  });
  return data;
}

const ACTIVE_SELLER = {
  kind: "seller" as const, authenticated: true, userId: "u1", email: "seller@example.com",
  sellerAccountId: "seller-1", country: "GH" as const, status: "active" as const,
};

const SUSPENDED_SELLER = { ...ACTIVE_SELLER, status: "suspended" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canTransitionOrder.mockReturnValue(true);
});

describe("bulkOrderStatusAction", () => {
  it("does nothing when the seller account is suspended", async () => {
    mocks.resolveServerActor.mockResolvedValue(SUSPENDED_SELLER);
    const from = vi.fn();
    mocks.createAdminClient.mockReturnValue({ from });

    await bulkOrderStatusAction(formData({ orderIds: ["order-1"], status: "cancelled" }));

    expect(from).not.toHaveBeenCalled();
  });

  it("calls finalize_order_stock with 'consumed' when bulk-completing orders", async () => {
    mocks.resolveServerActor.mockResolvedValue(ACTIVE_SELLER);
    const rpc = vi.fn().mockResolvedValue({});
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: "order-1" } });
    const updateEq2 = vi.fn().mockReturnValue({ select: () => ({ maybeSingle: updateMaybeSingle }) });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const update = vi.fn().mockReturnValue({ eq: updateEq1 });
    const selectIn = vi.fn().mockResolvedValue({ data: [{ id: "order-1", status: "processing", event_version: 1, payment_status: "paid" }] });
    const selectEq = vi.fn().mockReturnValue({ in: selectIn });
    const select = vi.fn().mockReturnValue({ eq: selectEq });
    const from = vi.fn((table: string) => (table === "orders" ? { select, update } : {}));
    mocks.createAdminClient.mockReturnValue({ from, rpc });

    await bulkOrderStatusAction(formData({ orderIds: ["order-1"], status: "completed" }));

    expect(rpc).toHaveBeenCalledWith("finalize_order_stock", { p_order_id: "order-1", p_outcome: "consumed" });
  });
});
```

- [ ] **Step 8: Run tests**

Run: `pnpm vitest run "src/app/(seller)/dashboard/orders/actions.test.ts"`
Expected: PASS.

- [ ] **Step 9: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 10: Manual verification**

`pnpm dev:local` — place a guest order with `inventory_policy=track` stock, confirm the product's `reserved_quantity` increments; mark the order completed (or pay via Paystack test mode), confirm `reserved_quantity` drops back and `stock_quantity` actually decrements.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/202607210039_stock_reservation_lifecycle.sql supabase/tests/database/020_stock_reservation_lifecycle.test.sql src/app/api/internal/inventory/sweep-expired-reservations/route.ts "src/app/(seller)/dashboard/orders/actions.ts" "src/app/(seller)/dashboard/orders/actions.test.ts" vercel.json
git commit -m "fix: finalize stock reservations on payment/completion, release on cancel, sweep expired ones; suspended sellers can no longer bulk-mutate orders"
```

---

### Task 5: Refund status reconciliation

**Files:**
- Create: `supabase/migrations/202607210040_refund_status_reconciliation.sql`
- Create: `supabase/tests/database/021_refund_status_reconciliation.test.sql`
- Modify: `src/app/api/payments/paystack/refund/route.ts`
- Modify: `src/app/api/payments/paystack/webhook/route.ts`

**Interfaces:**
- Produces: `apply_paystack_refund_event(p_event_key text, p_provider_refund_id text, p_status text, p_payload jsonb) returns boolean` — a new Postgres function, consumed by the webhook route.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/202607210040_refund_status_reconciliation.sql
-- Refund status was hardcoded to 'processing' at creation (discarding
-- Paystack's own reported status) and never updated afterward — no webhook
-- handler processed refund.* events. The cumulative-refund sum used to
-- block over-refunding counted these permanently-'processing' rows
-- regardless of whether Paystack actually completed them, so a silently
-- failed refund looked "done" forever and could never be retried.

create or replace function public.apply_paystack_refund_event(
  p_event_key text, p_provider_refund_id text, p_status text, p_payload jsonb
)
returns boolean language plpgsql security definer set search_path='' set row_security=off as $$
declare
  refund_record public.refunds%rowtype;
  mapped_status public.refund_status;
  completed_total bigint;
  order_total bigint;
begin
  insert into public.provider_events(provider,event_key,event_type,payload)
  values('paystack',p_event_key,'refund_event',p_payload) on conflict(provider,event_key) do nothing;
  if not found then return false; end if;

  select * into refund_record from public.refunds where provider_refund_id = p_provider_refund_id for update;
  if refund_record.id is null then
    update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
    return false;
  end if;

  mapped_status := case p_status
    when 'processed' then 'completed'::public.refund_status
    when 'failed' then 'failed'::public.refund_status
    else 'processing'::public.refund_status
  end;

  update public.refunds set status = mapped_status, updated_at = now() where id = refund_record.id;

  select total_minor into order_total from public.orders where id = refund_record.order_id for update;
  select coalesce(sum(amount_minor),0) into completed_total from public.refunds where order_id = refund_record.order_id and status = 'completed';

  update public.orders set refund_status = case
    when completed_total <= 0 then 'none'::public.refund_status
    when completed_total >= order_total then 'completed'::public.refund_status
    else 'partial'::public.refund_status
  end where id = refund_record.order_id;

  update public.provider_events set processed_at=now() where provider='paystack' and event_key=p_event_key;
  return true;
end; $$;

grant execute on function public.apply_paystack_refund_event(text,text,text,jsonb) to service_role;
```

- [ ] **Step 2: Write the pgTAP test**

Read `supabase/tests/database/005_orders.test.sql` for the fixture convention (shop/product/order) before writing this.

```sql
-- supabase/tests/database/021_refund_status_reconciliation.test.sql
begin;

set local search_path = extensions, public;

select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000021101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','refund-fixture@example.com','',now(),'{}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000021201','00000000-0000-0000-0000-000000021101','GH','active',true,'Refund Fixture Seller','refund-fixture@example.com','+233241234583');

insert into public.shops (id, seller_account_id, slug, display_name, legal_name, country, currency, status, published_at)
values ('00000000-0000-0000-0000-000000021301','00000000-0000-0000-0000-000000021201','refund-fixture-shop','Refund Fixture Shop','Refund Fixture Shop Ltd','GH','GHS','published',now());

insert into public.customers (id, seller_account_id, name, email, country)
values ('00000000-0000-0000-0000-000000021401','00000000-0000-0000-0000-000000021201','Refund Buyer','refund-buyer@example.com','GH');

insert into public.orders (id, shop_id, seller_account_id, customer_id, currency, subtotal_minor, delivery_minor, total_minor, payment_method, fulfillment_method_snapshot, buyer_snapshot, payment_status)
values ('00000000-0000-0000-0000-000000021501','00000000-0000-0000-0000-000000021301','00000000-0000-0000-0000-000000021201','00000000-0000-0000-0000-000000021401','GHS',10000,0,10000,'paystack','{}'::jsonb,'{}'::jsonb,'paid');

insert into public.payment_attempts (id, order_id, seller_account_id, reference, amount_minor, currency, status)
values ('00000000-0000-0000-0000-000000021601','00000000-0000-0000-0000-000000021501','00000000-0000-0000-0000-000000021201','refund-fixture-ref',10000,'GHS','paid');

insert into public.refunds (id, order_id, payment_attempt_id, seller_account_id, amount_minor, provider_refund_id, status)
values ('00000000-0000-0000-0000-000000021701','00000000-0000-0000-0000-000000021501','00000000-0000-0000-0000-000000021601','00000000-0000-0000-0000-000000021201',10000,'provider-refund-1','processing');

-- Webhook reports the refund actually processed: status flips to
-- 'completed' and the order's refund_status reflects full coverage.
select public.apply_paystack_refund_event('event-key-1','provider-refund-1','processed','{}'::jsonb);

select is(
  (select status from public.refunds where id = '00000000-0000-0000-0000-000000021701'),
  'completed',
  'refund status updates to completed on a processed webhook event'
);
select is(
  (select refund_status from public.orders where id = '00000000-0000-0000-0000-000000021501'),
  'completed',
  'order refund_status reflects the fully-refunded total'
);

-- A duplicate delivery of the same event is a safe no-op (idempotent via
-- provider_events' unique (provider,event_key)).
select is(
  (select public.apply_paystack_refund_event('event-key-1','provider-refund-1','processed','{}'::jsonb)),
  false,
  'a duplicate event_key is not reapplied'
);

-- An unknown provider_refund_id (never created via the refund route) is
-- rejected rather than silently creating orphaned state.
select is(
  (select public.apply_paystack_refund_event('event-key-2','not-a-real-refund-id','processed','{}'::jsonb)),
  false,
  'an event for an unknown refund is rejected'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run migration and pgTAP test**

Run: `pnpm db:reset && pnpm db:test`
Expected: `021_refund_status_reconciliation.test.sql .. ok`; only the known pre-existing `001_core.test.sql` failure remains.

- [ ] **Step 4: Update `refund/route.ts`**

Read the current file (34 lines) to confirm it matches, then replace it:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveServerActor } from "@/lib/auth/actor";
import { paystackProvider } from "@/lib/payments/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ orderId: z.uuid(), amountMinor: z.number().int().positive().optional() });

function mapInitialRefundStatus(providerStatus: string): "processing" | "completed" | "failed" {
  if (providerStatus === "processed") return "completed";
  if (providerStatus === "failed") return "failed";
  return "processing";
}

export async function POST(request: Request) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" && actor.kind !== "operator") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid refund." }, { status: 400 });
  const admin = createAdminClient();
  let query = admin.from("orders").select("id,seller_account_id,total_minor,payment_status").eq("id", parsed.data.orderId);
  if (actor.kind === "seller") query = query.eq("seller_account_id", actor.sellerAccountId);
  const { data: order } = await query.maybeSingle();
  if (!order || order.payment_status !== "paid") return NextResponse.json({ error: "Order is not refundable." }, { status: 409 });
  const { data: attempt } = await admin.from("payment_attempts").select("id,reference").eq("order_id", order.id).eq("status", "paid").maybeSingle();
  if (!attempt) return NextResponse.json({ error: "Paid attempt not found." }, { status: 409 });
  const { data: priorRefunds } = await admin.from("refunds").select("amount_minor").eq("order_id", order.id).neq("status", "failed");
  const alreadyRefundedMinor = (priorRefunds ?? []).reduce((sum, row) => sum + row.amount_minor, 0);
  const remainingMinor = order.total_minor - alreadyRefundedMinor;
  if (remainingMinor <= 0) return NextResponse.json({ error: "Order is already fully refunded." }, { status: 409 });
  const amount = parsed.data.amountMinor ?? remainingMinor;
  if (amount > remainingMinor) return NextResponse.json({ error: "Amount exceeds the unrefunded balance." }, { status: 400 });
  const result = await paystackProvider().refund({ reference: attempt.reference, amountMinor: amount });
  await admin.from("refunds").insert({
    order_id: order.id, payment_attempt_id: attempt.id, seller_account_id: order.seller_account_id,
    amount_minor: amount, provider_refund_id: result.providerId, status: mapInitialRefundStatus(result.status),
  });
  await admin.from("orders").update({ refund_status: "processing" }).eq("id", order.id).eq("refund_status", "none");
  return NextResponse.json({ status: "processing" }, { status: 202 });
}
```

(Changes: `.neq("status", "failed")` on the cumulative-sum query, `mapInitialRefundStatus(result.status)` instead of the hardcoded `"processing"` literal, and an `orders.refund_status` update so the order reflects "a refund is in flight" immediately instead of never being set at all. The `.eq("refund_status", "none")` guard avoids downgrading an order that already shows `partial`/`completed` from an earlier refund back to `processing` when a second refund is requested.)

- [ ] **Step 5: Update `webhook/route.ts`**

Read the current file (34 lines) to confirm it matches, then replace it:

```ts
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { enqueueOrderEventNotification } from "@/lib/notifications/enqueue";
import { verifyPaystackWebhook } from "@/lib/payments/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = request.headers.get("x-paystack-signature") ?? "";
  const raw = new Uint8Array(await request.arrayBuffer());
  if (!secret || !verifyPaystackWebhook(raw, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  const payload = JSON.parse(new TextDecoder().decode(raw));
  const admin = createAdminClient();
  const eventKey = String(payload.data?.id ?? createHash("sha256").update(raw).digest("hex"));

  if (payload.event === "charge.success") {
    const reference = payload.data?.reference;
    if (typeof reference !== "string") return NextResponse.json({ error: "Invalid event." }, { status: 400 });
    const { data, error } = await admin.rpc("apply_paystack_success", {
      p_reference: reference, p_event_key: eventKey, p_payload: payload,
    });
    if (error) return NextResponse.json({ error: "Event processing failed." }, { status: 500 });
    if (data) {
      const { data: attempt } = await admin
        .from("payment_attempts")
        .select("order_id")
        .eq("reference", reference)
        .maybeSingle();
      if (attempt?.order_id) {
        await enqueueOrderEventNotification(admin, attempt.order_id, "payment_succeeded");
      }
    }
    return NextResponse.json({ received: true, applied: data });
  }

  if (typeof payload.event === "string" && payload.event.startsWith("refund.")) {
    const refundId = payload.data?.id;
    const status = payload.data?.status;
    if (refundId == null || typeof status !== "string") {
      return NextResponse.json({ error: "Invalid event." }, { status: 400 });
    }
    const { error } = await admin.rpc("apply_paystack_refund_event", {
      p_event_key: eventKey, p_provider_refund_id: String(refundId), p_status: status, p_payload: payload,
    });
    if (error) return NextResponse.json({ error: "Event processing failed." }, { status: 500 });
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 6: Check for an existing test file and update/create it**

Check whether `src/app/api/payments/paystack/webhook/route.test.ts` and `src/app/api/payments/paystack/refund/route.test.ts` already exist. If either exists, read it in full and add cases matching its existing conventions for: (a) the refund route inserting with the mapped status instead of a hardcoded literal, and the `.neq("status","failed")` filter being present in the cumulative-sum query; (b) the webhook route correctly routing a `refund.processed` event to `apply_paystack_refund_event` with the right params, and still routing `charge.success` to `apply_paystack_success` unchanged. If neither test file exists, do not invent one for this task — this matches the established convention in this codebase where several already-audited routes (e.g. `verify/route.ts`, `initialize/route.ts`) also have no dedicated test file, and the pgTAP test in Step 2 already covers the core logic (`apply_paystack_refund_event`) that both routes depend on.

- [ ] **Step 7: Typecheck, lint, and run any updated/new tests**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean. If Step 6 added test cases, also run those specific test files and confirm they pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/202607210040_refund_status_reconciliation.sql supabase/tests/database/021_refund_status_reconciliation.test.sql src/app/api/payments/paystack/refund/route.ts src/app/api/payments/paystack/webhook/route.ts
git commit -m "fix: reconcile refund status against Paystack's actual reported outcome instead of a hardcoded literal"
```

(If Step 6 touched any test files, include them in this same commit.)

---

### Task 6: Scope `push_subscriptions` writes to service_role only

**Files:**
- Create: `supabase/migrations/202607210041_push_subscriptions_service_role_only.sql`
- Create: `supabase/tests/database/022_push_subscriptions_service_role_only.test.sql`

**Interfaces:** none new — `src/app/api/push/subscribe/route.ts` already writes via `createAdminClient()` (service_role), so no application code changes.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/202607210041_push_subscriptions_service_role_only.sql
-- push_own_insert used with check(true) — anyone could insert a push
-- subscription under an arbitrary seller_account_id or customer_id,
-- letting an attacker intercept another seller's push notifications. The
-- only real write path (src/app/api/push/subscribe/route.ts) already does
-- its own ownership verification and writes via the service-role admin
-- client, so the direct anon/authenticated grant was never actually needed.

drop policy push_own_insert on public.push_subscriptions;
revoke insert on public.push_subscriptions from anon, authenticated;
```

- [ ] **Step 2: Write the pgTAP test**

```sql
-- supabase/tests/database/022_push_subscriptions_service_role_only.test.sql
begin;

set local search_path = extensions, public;

select plan(2);

select throws_ok(
  $$ set local role authenticated;
     insert into public.push_subscriptions (seller_account_id, endpoint, p256dh, auth)
     values (gen_random_uuid(), 'https://example.com/push/attacker', 'x', 'y') $$,
  '42501',
  null,
  'authenticated cannot insert push_subscriptions directly'
);

select lives_ok(
  $$ insert into public.push_subscriptions (seller_account_id, endpoint, p256dh, auth)
     values (gen_random_uuid(), 'https://example.com/push/service-role-write', 'x', 'y') $$,
  'service_role (the default test role) can still insert push_subscriptions'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run migration and pgTAP test**

Run: `pnpm db:reset && pnpm db:test`
Expected: `022_push_subscriptions_service_role_only.test.sql .. ok`; only the known pre-existing `001_core.test.sql` failure remains.

- [ ] **Step 4: Manual verification**

`pnpm dev:local` — trigger a push subscription from the storefront/dashboard (wherever the push opt-in UI lives) and confirm it still succeeds (proving `push/subscribe/route.ts`'s admin-client write path is unaffected).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607210041_push_subscriptions_service_role_only.sql supabase/tests/database/022_push_subscriptions_service_role_only.test.sql
git commit -m "fix: restrict push_subscriptions writes to service_role, closing the unscoped anon/authenticated insert policy"
```

---

### Task 7: `case_messages` must respect `operator_only`

**Files:**
- Create: `supabase/migrations/202607210042_case_messages_operator_only.sql`
- Create: `supabase/tests/database/023_case_messages_operator_only.test.sql`

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Write the pgTAP test**

Read `supabase/tests/database/007_teams.test.sql` or another file that already exercises `support_cases`/operator role fixtures for the exact convention before writing this.

```sql
-- supabase/tests/database/023_case_messages_operator_only.test.sql
begin;

set local search_path = extensions, public;

select plan(3);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000023101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','case-fixture@example.com','',now(),'{}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000023201','00000000-0000-0000-0000-000000023101','GH','active',true,'Case Fixture Seller','case-fixture@example.com','+233241234584');

insert into public.support_cases (id, seller_account_id, kind, status, subject)
values ('00000000-0000-0000-0000-000000023301','00000000-0000-0000-0000-000000023201','dispute','open','Fixture case');

insert into public.case_messages (id, case_id, actor_type, body, operator_only)
values
  ('00000000-0000-0000-0000-000000023401','00000000-0000-0000-0000-000000023301','seller','A message the seller wrote', false),
  ('00000000-0000-0000-0000-000000023402','00000000-0000-0000-0000-000000023301','operator','Internal fraud note', true);

select is(
  (select count(*)::int from public.case_messages where case_id = '00000000-0000-0000-0000-000000023301'),
  2,
  'both messages exist in the fixture'
);

-- As the seller who owns this case: only the non-operator-only message is
-- visible through the policy's condition (checked directly, not via
-- set role, since current_seller_account_id() depends on a JWT claim this
-- test transaction doesn't have — verify the policy's boolean condition
-- the same way for both rows instead).
select is(
  (select case_messages.operator_only from public.case_messages
    join public.support_cases c on c.id = case_messages.case_id
    where case_messages.id = '00000000-0000-0000-0000-000000023401'),
  false,
  'the seller-authored message is not operator_only (should remain visible to the seller)'
);
select is(
  (select case_messages.operator_only from public.case_messages
    join public.support_cases c on c.id = case_messages.case_id
    where case_messages.id = '00000000-0000-0000-0000-000000023402'),
  true,
  'the internal fraud note is operator_only (must now be excluded from the seller-visible policy condition)'
);

select * from finish();
rollback;
```

Note for the implementer: the third and fourth assertions above are a weaker proxy check (confirming the data shape) rather than a true RLS-as-the-seller check, because `current_seller_account_id()` reads a JWT claim (`auth.uid()`) that a plain pgTAP transaction doesn't have set. If this codebase's existing RLS tests (check `002_rls.test.sql`) have an established pattern for impersonating a specific authenticated user's JWT claims in a pgTAP test (e.g. via `set local request.jwt.claims` or a test helper), use that exact pattern instead to write a true policy-enforcement test — read that file first and prefer its convention over the weaker proxy shown here if one exists.

- [ ] **Step 3: Run migration and pgTAP test**

Run: `pnpm db:reset && pnpm db:test`
Expected: `023_case_messages_operator_only.test.sql .. ok`; only the known pre-existing `001_core.test.sql` failure remains.

- [ ] **Step 4: Manual verification**

`pnpm dev:local` — as an operator, add an internal-only note to a support case; confirm (via the seller-facing case view) that the note does not appear, while a non-internal message does.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607210042_case_messages_operator_only.sql supabase/tests/database/023_case_messages_operator_only.test.sql
git commit -m "fix: case_messages RLS now respects operator_only, hiding internal notes from the seller under review"
```

---

### Task 8: Enforce role permissions on team-writable growth/settings/share actions

**Files:**
- Modify: `src/app/(seller)/dashboard/growth/promotions/actions.ts`
- Modify: `src/app/(seller)/dashboard/growth/campaigns/actions.ts`
- Modify: `src/app/(seller)/dashboard/growth/broadcasts/actions.ts`
- Modify: `src/app/(seller)/dashboard/growth/segments/actions.ts`
- Modify: `src/app/(seller)/dashboard/settings/branding/actions.ts`
- Modify: `src/app/(seller)/dashboard/settings/discovery/actions.ts`
- Modify: `src/app/(seller)/dashboard/settings/fulfillment/actions.ts`
- Modify: `src/app/(seller)/dashboard/settings/notifications/actions.ts`
- Modify: `src/app/(seller)/dashboard/share/actions.ts`
- Create: `src/app/(seller)/dashboard/growth/promotions/actions.test.ts`
- Create: `src/app/(seller)/dashboard/settings/branding/actions.test.ts`

**Interfaces:**
- Consumes: `hasPermission(role: TeamRole, permission: Permission)` from `@/lib/auth/permissions` — the matrix only has `"campaigns.manage"` (growth/share surfaces) and `"settings.manage"` (settings surfaces) as the relevant broad keys, no finer-grained ones exist. Calling convention everywhere else in this codebase is `hasPermission(actor.role ?? "owner", "<key>")`.

- [ ] **Step 1: Write the two new test files first (TDD — confirm they fail before the fix)**

```ts
// src/app/(seller)/dashboard/growth/promotions/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  getSellerPlan: vi.fn(),
  planAllows: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/billing/resolve", () => ({ getSellerPlan: mocks.getSellerPlan, planAllows: mocks.planAllows }));

import { createPromotion } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSellerPlan.mockResolvedValue({});
  mocks.planAllows.mockReturnValue(true);
});

describe("createPromotion", () => {
  it("rejects a team member whose role lacks campaigns.manage", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "seller", sellerAccountId: "seller-1", status: "active", role: "support",
    });
    const from = vi.fn();
    mocks.createClient.mockResolvedValue({ from });

    await createPromotion(formData({ kind: "fixed", value: "500", code: "SAVE5" }));

    expect(from).not.toHaveBeenCalled();
  });

  it("allows the owner (no role set) to create a promotion", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "seller", sellerAccountId: "seller-1", status: "active", role: undefined,
    });
    const insert = vi.fn().mockResolvedValue({});
    const shopSingle = vi.fn().mockResolvedValue({ data: { id: "shop-1" } });
    const shopEq = vi.fn().mockReturnValue({ single: shopSingle });
    const shopSelect = vi.fn().mockReturnValue({ eq: shopEq });
    const from = vi.fn((table: string) => (table === "shops" ? { select: shopSelect } : { insert }));
    mocks.createClient.mockResolvedValue({ from });

    await createPromotion(formData({ kind: "fixed", value: "500", code: "SAVE5" }));

    expect(insert).toHaveBeenCalled();
  });
});
```

```ts
// src/app/(seller)/dashboard/settings/branding/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  getSellerPlan: vi.fn(),
  planAllows: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/billing/resolve", () => ({ getSellerPlan: mocks.getSellerPlan, planAllows: mocks.planAllows }));

import { addCustomDomain } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSellerPlan.mockResolvedValue({});
  mocks.planAllows.mockReturnValue(true);
});

describe("addCustomDomain", () => {
  it("rejects a team member whose role lacks settings.manage", async () => {
    mocks.resolveServerActor.mockResolvedValue({
      kind: "seller", sellerAccountId: "seller-1", status: "active", role: "analyst",
    });
    const from = vi.fn();
    mocks.createClient.mockResolvedValue({ from });

    await addCustomDomain(formData({ hostname: "shop.example.com" }));

    expect(from).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run both new test files to verify they fail**

Run: `pnpm vitest run "src/app/(seller)/dashboard/growth/promotions/actions.test.ts" "src/app/(seller)/dashboard/settings/branding/actions.test.ts"`
Expected: FAIL — `createPromotion`/`addCustomDomain` don't check `hasPermission` yet, so the "rejects" cases incorrectly proceed to call `from`.

- [ ] **Step 3: Update `growth/promotions/actions.ts`**

Replace the whole file:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { resolveServerActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { getSellerPlan, planAllows } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";
export async function createPromotion(formData: FormData) {
  const actor=await resolveServerActor(); if(actor.kind!=="seller"||!hasPermission(actor.role??"owner","campaigns.manage")) return;
  const plan=await getSellerPlan(actor.sellerAccountId); if(!planAllows(plan,"promotions")) return;
  const supabase=await createClient(); const {data:shop}=await supabase.from("shops").select("id").eq("seller_account_id",actor.sellerAccountId).single(); if(!shop)return;
  const kind=String(formData.get("kind")); const value=Number(formData.get("value")); const code=String(formData.get("code")).trim().toUpperCase();
  if(!["fixed","percentage"].includes(kind)||!code||!Number.isInteger(value)||value<=0||(kind==="percentage"&&value>100))return;
  await supabase.from("promotions").insert({seller_account_id:actor.sellerAccountId,shop_id:shop.id,name:String(formData.get("name")).trim()||code,code,kind,value,minimum_minor:Number(formData.get("minimumMinor")||0),redemption_limit:Number(formData.get("redemptionLimit")||0)||null});
  revalidatePath("/dashboard/growth/promotions");
}
```

- [ ] **Step 4: Update `growth/campaigns/actions.ts`**

Replace the whole file:

```ts
"use server";
import {revalidatePath} from "next/cache";import {resolveServerActor} from "@/lib/auth/actor";import {hasPermission} from "@/lib/auth/permissions";import {getSellerPlan,planAllows} from "@/lib/billing/resolve";import {normalizeCampaignToken} from "@/lib/campaigns/links";import {createClient} from "@/lib/supabase/server";
export async function createCampaign(formData:FormData){const actor=await resolveServerActor();if(actor.kind!=="seller"||!hasPermission(actor.role??"owner","campaigns.manage"))return;const plan=await getSellerPlan(actor.sellerAccountId);if(!planAllows(plan,"campaigns"))return;const supabase=await createClient();const{data:shop}=await supabase.from("shops").select("id").eq("seller_account_id",actor.sellerAccountId).single();if(!shop)return;const name=String(formData.get("name")).trim();const channel=String(formData.get("channel"));if(!name||!["snapchat","tiktok","instagram","whatsapp","other"].includes(channel))return;await supabase.from("campaign_links").insert({seller_account_id:actor.sellerAccountId,shop_id:shop.id,name,token:`${normalizeCampaignToken(name)}-${crypto.randomUUID().slice(0,6)}`,channel});revalidatePath("/dashboard/growth/campaigns")}
```

- [ ] **Step 5: Update `growth/broadcasts/actions.ts`**

Add the import and update the three `if (actor.kind !== "seller") return;` guards (lines 27, 60, 77):

```ts
import { hasPermission } from "@/lib/auth/permissions";
```

(placed alongside the other `@/lib/auth/actor` import, keeping import order consistent with the file's existing grouping)

Change line 27 (`createBroadcast`): `if (actor.kind !== "seller") return;` → `if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "campaigns.manage")) return;`

Change line 60 (`scheduleBroadcast`): same replacement.

Change line 77 (`cancelBroadcast`): same replacement.

- [ ] **Step 6: Update `growth/segments/actions.ts`**

Replace the whole file:

```ts
"use server";import {revalidatePath} from "next/cache";import {resolveServerActor} from "@/lib/auth/actor";import {hasPermission} from "@/lib/auth/permissions";import {getSellerPlan,withinPlanLimit} from "@/lib/billing/resolve";import {createClient} from "@/lib/supabase/server";
export async function createSegment(formData:FormData){const actor=await resolveServerActor();if(actor.kind!=="seller"||!hasPermission(actor.role??"owner","campaigns.manage"))return;const name=String(formData.get("name")).trim();if(!name)return;
  const plan=await getSellerPlan(actor.sellerAccountId);const admin=await createClient();const{count}=await admin.from("customer_segments").select("id",{count:"exact",head:true}).eq("seller_account_id",actor.sellerAccountId);if(!withinPlanLimit(plan,"customerSegments",count??0))return;const rules={minimumOrders:Number(formData.get("minimumOrders")||0),minimumSpendMinor:Number(formData.get("minimumSpendMinor")||0),orderedWithinDays:Number(formData.get("orderedWithinDays")||0)||undefined};const supabase=await createClient();await supabase.from("customer_segments").insert({seller_account_id:actor.sellerAccountId,name,rules});revalidatePath("/dashboard/growth/segments")}
```

- [ ] **Step 7: Update `settings/branding/actions.ts`**

Add `import { hasPermission } from "@/lib/auth/permissions";` alongside the existing imports, then update every actor-kind guard to also require `"settings.manage"`:

Line 14 (`saveBranding`): `if (actor.kind !== "seller") return;` → `if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "settings.manage")) return;`

Line 33 (`uploadShopLogoAction`): `if (actor.kind !== "seller" || !["pending", "active"].includes(actor.status)) {` → `if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "settings.manage") || !["pending", "active"].includes(actor.status)) {`

Line 86 (`removeShopLogoAction`): `if (actor.kind !== "seller") return;` → `if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "settings.manage")) return;`

Line 108 (`addCustomDomain`): `if (actor.kind !== "seller") return;` → `if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "settings.manage")) return;`

Line 121 (`verifyCustomDomain`): `if (actor.kind !== "seller") return;` → `if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "settings.manage")) return;`

- [ ] **Step 8: Update `settings/discovery/actions.ts`**

Replace the whole file:

```ts
"use server";import {revalidatePath} from "next/cache";import {resolveServerActor} from "@/lib/auth/actor";import {hasPermission} from "@/lib/auth/permissions";import {getSellerPlan,planAllows} from "@/lib/billing/resolve";import {createClient} from "@/lib/supabase/server";
export async function saveDiscovery(formData:FormData){const actor=await resolveServerActor();if(actor.kind!=="seller"||!hasPermission(actor.role??"owner","settings.manage"))return;
  if(formData.get("optedIn")==="on"){const plan=await getSellerPlan(actor.sellerAccountId);if(!planAllows(plan,"discovery"))return;}
  const supabase=await createClient();const{data:shop}=await supabase.from("shops").select("id").eq("seller_account_id",actor.sellerAccountId).single();if(!shop)return;await supabase.from("discovery_preferences").upsert({shop_id:shop.id,seller_account_id:actor.sellerAccountId,opted_in:formData.get("optedIn")==="on",category:String(formData.get("category")).trim()||null,city:String(formData.get("city")).trim()||null,description:String(formData.get("description")).trim()||null});await supabase.rpc("refresh_discovery_listing",{p_shop_id:shop.id});revalidatePath("/dashboard/settings/discovery");revalidatePath("/discover")}
```

- [ ] **Step 9: Update `settings/fulfillment/actions.ts`**

Add `import { hasPermission } from "@/lib/auth/permissions";` alongside the existing imports, then update the three guards:

Line 11 (`saveFulfillmentMethod`): `if (actor.kind !== "seller" || !["pending", "active"].includes(actor.status)) return;` → `if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "settings.manage") || !["pending", "active"].includes(actor.status)) return;`

Line 42 (`updateFulfillmentFee`): same replacement.

Line 58 (`toggleFulfillmentMethod`): same replacement.

- [ ] **Step 10: Update `settings/notifications/actions.ts`**

Replace the whole file:

```ts
"use server";import {revalidatePath} from "next/cache";import {resolveServerActor} from "@/lib/auth/actor";import {hasPermission} from "@/lib/auth/permissions";import {createClient} from "@/lib/supabase/server";
export async function saveNotificationPreferences(formData:FormData){const actor=await resolveServerActor();if(actor.kind!=="seller"||!hasPermission(actor.role??"owner","settings.manage"))return;const frequency=String(formData.get("frequency"));if(!["instant","daily","weekly","off"].includes(frequency))return;const supabase=await createClient();await supabase.from("notification_preferences").upsert({seller_account_id:actor.sellerAccountId,order_email:formData.get("email")==="on",order_whatsapp:formData.get("whatsapp")==="on",order_sms:formData.get("sms")==="on",digest_frequency:frequency,marketing_frequency_cap:Number(formData.get("cap")||4)});revalidatePath("/dashboard/settings/notifications")}
```

- [ ] **Step 11: Update `share/actions.ts`**

Add `import { hasPermission } from "@/lib/auth/permissions";` alongside the existing imports, then update both guards:

Line 10 (`disconnectSocialAccountAction`): `if (actor.kind !== "seller") return;` → `if (actor.kind !== "seller" || !hasPermission(actor.role ?? "owner", "campaigns.manage")) return;`

Line 39 (`generateShareLinksAction`): same replacement.

- [ ] **Step 12: Run the two new test files to verify they pass**

Run: `pnpm vitest run "src/app/(seller)/dashboard/growth/promotions/actions.test.ts" "src/app/(seller)/dashboard/settings/branding/actions.test.ts"`
Expected: PASS.

- [ ] **Step 13: Run the pre-existing broadcasts test to confirm no regression**

Run: `pnpm vitest run "src/app/(seller)/dashboard/growth/broadcasts/actions.test.ts"`
Expected: PASS — its `SELLER_ACTOR` fixture has no `role` set, so `actor.role ?? "owner"` still resolves to `"owner"`, which has `campaigns.manage`.

- [ ] **Step 14: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 15: Commit**

```bash
git add "src/app/(seller)/dashboard/growth/promotions/actions.ts" "src/app/(seller)/dashboard/growth/promotions/actions.test.ts" "src/app/(seller)/dashboard/growth/campaigns/actions.ts" "src/app/(seller)/dashboard/growth/broadcasts/actions.ts" "src/app/(seller)/dashboard/growth/segments/actions.ts" "src/app/(seller)/dashboard/settings/branding/actions.ts" "src/app/(seller)/dashboard/settings/branding/actions.test.ts" "src/app/(seller)/dashboard/settings/discovery/actions.ts" "src/app/(seller)/dashboard/settings/fulfillment/actions.ts" "src/app/(seller)/dashboard/settings/notifications/actions.ts" "src/app/(seller)/dashboard/share/actions.ts"
git commit -m "fix: enforce role permissions (campaigns.manage / settings.manage) on team-writable growth, settings, and share actions"
```

---

### Task 9: Restrict UPDATE on webhook/courier secret columns

**Files:**
- Create: `supabase/migrations/202607210043_restrict_secret_column_updates.sql`
- Create: `supabase/tests/database/024_restrict_secret_column_updates.test.sql`

**Interfaces:** none new — confirmed no application code ever updates `secret_encrypted`/`credentials_encrypted` after creation (only `addWebhook`'s INSERT sets it), so this restriction cannot break any existing flow.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/202607210043_restrict_secret_column_updates.sql
-- outbound_webhooks.secret_encrypted and courier_connections.credentials_encrypted
-- were fully update-grantable to the owning seller via PostgREST, unlike the
-- equivalent social_accounts.access_token_sealed pattern (select+delete only).
-- Unlike that OAuth-derived token, these two values ARE legitimately
-- seller-authored at creation time (addWebhook inserts the seller's own
-- chosen signing secret) — so INSERT stays open, but no application code
-- ever updates either column after creation, so UPDATE is restricted here
-- to close a write path that doesn't need to exist.
--
-- Postgres column-level grants are additive on top of the table-level
-- grant, so we revoke table-level UPDATE (removing update rights on every
-- column) and re-grant UPDATE scoped to only the non-secret columns.

revoke update on public.outbound_webhooks from authenticated;
grant update (url, event_types, active) on public.outbound_webhooks to authenticated;

revoke update on public.courier_connections from authenticated;
grant update (provider, active) on public.courier_connections to authenticated;
```

- [ ] **Step 2: Write the pgTAP test**

```sql
-- supabase/tests/database/024_restrict_secret_column_updates.test.sql
begin;

set local search_path = extensions, public;

select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000024101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','secret-fixture@example.com','',now(),'{}'::jsonb,now(),now());

insert into public.seller_accounts (id, auth_user_id, country, status, is_active, contact_name, contact_email, contact_phone)
values ('00000000-0000-0000-0000-000000024201','00000000-0000-0000-0000-000000024101','GH','active',true,'Secret Fixture Seller','secret-fixture@example.com','+233241234585');

insert into public.outbound_webhooks (id, seller_account_id, url, secret_encrypted, event_types)
values ('00000000-0000-0000-0000-000000024301','00000000-0000-0000-0000-000000024201','https://example.com/hook','original-secret','{}');

insert into public.courier_connections (id, seller_account_id, provider, credentials_encrypted)
values ('00000000-0000-0000-0000-000000024401','00000000-0000-0000-0000-000000024201','fixture-provider','original-creds');

select throws_ok(
  $$ set local role authenticated; update public.outbound_webhooks set secret_encrypted = 'attacker-secret' where id = '00000000-0000-0000-0000-000000024301' $$,
  '42501',
  null,
  'authenticated cannot update outbound_webhooks.secret_encrypted'
);
select lives_ok(
  $$ set local role authenticated; update public.outbound_webhooks set active = false where id = '00000000-0000-0000-0000-000000024301' $$,
  'authenticated can still update outbound_webhooks.active'
);
select throws_ok(
  $$ set local role authenticated; update public.courier_connections set credentials_encrypted = 'attacker-creds' where id = '00000000-0000-0000-0000-000000024401' $$,
  '42501',
  null,
  'authenticated cannot update courier_connections.credentials_encrypted'
);
select lives_ok(
  $$ set local role authenticated; update public.courier_connections set active = false where id = '00000000-0000-0000-0000-000000024401' $$,
  'authenticated can still update courier_connections.active'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run migration and pgTAP test**

Run: `pnpm db:reset && pnpm db:test`
Expected: `024_restrict_secret_column_updates.test.sql .. ok`; only the known pre-existing `001_core.test.sql` failure remains.

- [ ] **Step 4: Manual verification**

`pnpm dev:local` — as a seller, toggle a webhook's active state or a courier connection's active state in Settings → Developers and confirm it still saves correctly (proving the non-secret column updates still work through the real UI).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607210043_restrict_secret_column_updates.sql supabase/tests/database/024_restrict_secret_column_updates.test.sql
git commit -m "fix: restrict UPDATE on webhook/courier secret columns, matching the social_accounts secret-handling pattern"
```

---

### Task 10: Store the trimmed webhook URL

**Files:**
- Modify: `src/app/(seller)/dashboard/settings/developers/actions.ts`

- [ ] **Step 1: Update `addWebhook`**

Read the current full file first, then change the `addWebhook` function:

```ts
export async function addWebhook(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role) return;
  const webhookPlan = await getSellerPlan(actor.sellerAccountId);
  if (planLimit(webhookPlan, "apiKeys") === 0) return;
  const url = String(formData.get("url")).trim();
  if (!(await isSafeWebhookUrl(url))) return;
  const supabase = await createClient();
  await supabase.from("outbound_webhooks").insert({ seller_account_id: actor.sellerAccountId, url, secret_encrypted: String(formData.get("secret")), event_types: formData.getAll("event").map(String) });
  revalidatePath("/dashboard/settings/developers");
}
```

(Only change: `String(formData.get("url"))` → `String(formData.get("url")).trim()`, so the stored `url` is the same trimmed string that `isSafeWebhookUrl` validated, rather than the raw untrimmed input.)

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(seller)/dashboard/settings/developers/actions.ts"
git commit -m "fix: store the trimmed webhook URL, matching what isSafeWebhookUrl actually validated"
```

---

### Task 11: Full verification pass

**Files:** none — this task runs checks across everything built in Tasks 1–10.

- [ ] **Step 1: Run the full automated suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: typecheck clean, lint clean, all vitest suites pass.

- [ ] **Step 2: Database**

Run: `pnpm db:reset && pnpm db:test`
Expected: all new pgTAP files (`018` through `024`) pass; the one known pre-existing unrelated `001_core.test.sql` plan-versioning failure is not a new regression; `005_orders.test.sql`/`006_growth_core.test.sql` (which exercise the guest-checkout RPC chain touched by Task 3) still pass.

- [ ] **Step 3: Manual end-to-end spot-check**

`pnpm dev:local`:
1. Place a real guest checkout order end-to-end — confirm it still succeeds (Task 3's grant revocation didn't break the legitimate path) and that the product's `reserved_quantity` increments, then drops back to 0 with `stock_quantity` correctly decremented once the order is marked paid/completed (Task 4).
2. As a team member with a restricted role (e.g. `support` or `analyst`), confirm the growth/branding/fulfillment/discovery/notifications/share actions from Task 8 are now blocked, while the same actions succeed for an `owner`/`manager`.
3. As an operator, suspend a seller, then confirm that seller's session can no longer bulk-update orders (Task 4/finding #6).
4. Issue a refund and confirm the order shows `refund_status: processing` immediately (Task 5) rather than never updating.
5. Confirm login OTP send/verify/resend all still work normally under everyday (non-attack) usage — the rate limiter (Task 1/2) should be invisible to a legitimate user.

- [ ] **Step 4: Report results**

No commit for this task — it's verification only. If any check fails, return to the relevant task above and fix before considering the plan complete.
