# Unified Email/Phone OTP Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SnapDuka's email+password login with a single "email or phone number, then a typed 6-digit code" flow — no passwords anywhere, same code-entry UX for both channels, Google OAuth untouched.

**Architecture:** One freeform identifier field is classified client-side-free (server-only, no client JS needed) as email or phone via a small `classifyIdentifier()` helper. `signInWithOtp` sends a code (email or SMS depending on classification); Supabase auto-creates the auth user on first use, so there is no separate "sign up" step — one flow serves both new and returning sellers. `verifyOtp` with a typed 6-digit code (never a clicked link) completes the sign-in, which also marks `email_confirmed_at`/`phone_confirmed_at` as a side effect. Four places that currently hard-require a verified email are relaxed to accept a verified phone instead. Twilio is wired as the SMS provider (real credentials to be supplied by the user before phone OTP can be tested end-to-end).

**Tech Stack:** Next.js Server Actions, Supabase Auth (`signInWithOtp`/`verifyOtp`), Supabase Postgres/RLS, Twilio (SMS provider, local `config.toml` + Supabase Cloud dashboard for production).

## Global Constraints

- No live subscribers/users exist — no backward-compatible data migration needed.
- Password login, signup, and the `PasswordStrengthInput` component are deleted entirely — not kept as an option.
- The typed code is the only verification path — no clickable magic link. The custom email template must show only the code.
- Google OAuth (`signInWithSocial`) stays exactly as-is — do not touch its flow or its `auth/confirm/route.ts` `code`-exchange branch.
- `seller_accounts.contact_phone` stays mandatory regardless of login channel (collected via the onboarding form either way) — only `contact_email` becomes optional.
- Migration files: check `ls supabase/migrations | tail -3` before writing Task 2 — this plan assumes the next number is `202607190033`; bump if a later migration already exists.
- pgTAP test files: check `ls supabase/tests/database | tail -3` before writing Task 2 — this plan assumes `014_auth_otp.test.sql`; bump if `014` is already taken.
- You will need real Twilio credentials to test phone OTP end-to-end — the user will supply these; Task 9 only wires the configuration, it cannot verify a real SMS round-trip in this environment.

---

### Task 1: `classifyIdentifier()` helper

**Files:**
- Create: `src/lib/auth/identifier.ts`
- Create: `src/lib/auth/identifier.test.ts`

**Interfaces:**
- Produces: `classifyIdentifier(raw: string): { kind: "email"; value: string } | { kind: "phone"; value: string } | { kind: "invalid" }` — consumed by Task 5 (login actions).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/auth/identifier.test.ts
import { describe, expect, it } from "vitest";

import { classifyIdentifier } from "./identifier";

describe("classifyIdentifier", () => {
  it("classifies a valid email, lowercased and trimmed", () => {
    expect(classifyIdentifier("  Seller@Example.com  ")).toEqual({
      kind: "email",
      value: "seller@example.com",
    });
  });

  it("classifies a valid E.164 phone number", () => {
    expect(classifyIdentifier("+233241234567")).toEqual({
      kind: "phone",
      value: "+233241234567",
    });
  });

  it("strips spaces and dashes from a phone number before classifying", () => {
    expect(classifyIdentifier("+233 24-123-4567")).toEqual({
      kind: "phone",
      value: "+233241234567",
    });
  });

  it("rejects an invalid email", () => {
    expect(classifyIdentifier("not-an-email@")).toEqual({ kind: "invalid" });
  });

  it("rejects a phone number with no country code", () => {
    expect(classifyIdentifier("0241234567")).toEqual({ kind: "invalid" });
  });

  it("rejects an empty string", () => {
    expect(classifyIdentifier("   ")).toEqual({ kind: "invalid" });
  });

  it("rejects gibberish that is neither an email nor a phone number", () => {
    expect(classifyIdentifier("hello world")).toEqual({ kind: "invalid" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/auth/identifier.test.ts`
Expected: FAIL — `Cannot find module './identifier'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/auth/identifier.ts
import { z } from "zod";

export type ClassifiedIdentifier =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string }
  | { kind: "invalid" };

/** Matches the E.164 shape already enforced on seller_accounts.contact_phone
 * (supabase/migrations/202606120001_core.sql). */
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;

/**
 * Classifies a single freeform login identifier as an email or an E.164
 * phone number. Used by the login flow so one input field can accept
 * either — there is no separate email/phone toggle in the UI.
 */
export function classifyIdentifier(raw: string): ClassifiedIdentifier {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "invalid" };

  if (trimmed.includes("@")) {
    const parsed = z.email().safeParse(trimmed.toLowerCase());
    return parsed.success ? { kind: "email", value: parsed.data } : { kind: "invalid" };
  }

  const normalized = trimmed.replace(/[\s()-]/g, "");
  return PHONE_PATTERN.test(normalized) ? { kind: "phone", value: normalized } : { kind: "invalid" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/auth/identifier.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/identifier.ts src/lib/auth/identifier.test.ts
git commit -m "feat: add classifyIdentifier helper for unified email/phone login"
```

---

### Task 2: Migration — nullable `contact_email` + phone-aware `bootstrap_seller_account`

**Files:**
- Create: `supabase/migrations/202607190033_auth_otp.sql`
- Create: `supabase/tests/database/014_auth_otp.test.sql`

**Interfaces:**
- Produces: `seller_accounts.contact_email` becomes nullable — consumed by Task 3 (`onboarding.ts` schema) and Task 4 (`onboarding/actions.ts` write).
- Produces: `bootstrap_seller_account(p_auth_user_id, p_country, p_contact_name, p_contact_phone)` now succeeds for a phone-verified user with no email at all (raises only when NEITHER email nor phone is verified) — no signature change, callers in `onboarding/actions.ts` are unaffected.

- [ ] **Step 1: Confirm the next migration/test numbers**

Run: `ls supabase/migrations | tail -3 && ls supabase/tests/database | tail -3`
Expected: confirms `202607190033` and `014` are free. If not, use the next free numbers in both filenames throughout this task.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/202607190033_auth_otp.sql
-- Unified email/phone OTP login: contact_email becomes optional so a
-- phone-only seller can complete onboarding without ever supplying an
-- email. bootstrap_seller_account now accepts either a verified email or
-- a verified phone from auth.users (it previously required a verified
-- email unconditionally). contact_phone stays mandatory regardless of
-- login channel — it is always collected via the onboarding form.

alter table public.seller_accounts
  alter column contact_email drop not null;

alter table public.seller_accounts
  drop constraint seller_accounts_contact_email_check;

alter table public.seller_accounts
  add constraint seller_accounts_contact_email_check
  check (
    contact_email is null
    or (
      contact_email = lower(contact_email)
      and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

create or replace function public.bootstrap_seller_account(
  p_auth_user_id uuid,
  p_country public.country_code,
  p_contact_name text,
  p_contact_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  verified_email text;
  is_phone_verified boolean;
  seller_id uuid;
begin
  select
    case when email_confirmed_at is not null then lower(email) else null end,
    phone_confirmed_at is not null
  into verified_email, is_phone_verified
  from auth.users
  where id = p_auth_user_id
    and (email_confirmed_at is not null or phone_confirmed_at is not null);

  if verified_email is null and not coalesce(is_phone_verified, false) then
    raise exception using
      errcode = '42501',
      message = 'A verified email or phone number is required.';
  end if;

  insert into public.seller_accounts (
    auth_user_id,
    country,
    status,
    is_active,
    contact_name,
    contact_email,
    contact_phone
  )
  values (
    p_auth_user_id,
    p_country,
    'pending',
    false,
    btrim(p_contact_name),
    verified_email,
    p_contact_phone
  )
  on conflict (auth_user_id) do update
  set auth_user_id = excluded.auth_user_id
  returning id into seller_id;

  insert into public.seller_verifications (
    seller_account_id,
    state,
    metadata
  )
  values (
    seller_id,
    'not_started',
    '{}'::jsonb
  )
  on conflict (seller_account_id) do nothing;

  return seller_id;
end;
$$;
```

- [ ] **Step 3: Apply it locally and confirm it runs clean**

Run: `pnpm db:reset`
Expected: log shows `Applying migration 202607190033_auth_otp.sql...` with no error, ending in `Finished supabase db reset`.

- [ ] **Step 4: Write the pgTAP test**

```sql
-- supabase/tests/database/014_auth_otp.test.sql
begin;

set local search_path = extensions, public;

select plan(5);

select ok(
  is_nullable('public', 'seller_accounts', 'contact_email'),
  'seller_accounts.contact_email is nullable'
);

-- Phone-only confirmed user: bootstrap succeeds with contact_email null.
insert into auth.users (
  id, instance_id, aud, role, email, phone, encrypted_password,
  email_confirmed_at, phone_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000008101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', null, '+233241234599', '',
  null, now(), '{}'::jsonb, now(), now()
);

select lives_ok(
  $$
    select public.bootstrap_seller_account(
      '00000000-0000-0000-0000-000000008101',
      'GH', 'Phone Only Seller', '+233241234599'
    )
  $$,
  'bootstrap_seller_account succeeds for a phone-verified, email-less user'
);

select is(
  (select contact_email from public.seller_accounts where auth_user_id = '00000000-0000-0000-0000-000000008101'),
  null,
  'the resulting seller_accounts row has a null contact_email'
);

-- Neither email nor phone verified: bootstrap still raises.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000008102',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'unverified@example.com', '',
  null, '{}'::jsonb, now(), now()
);

select throws_ok(
  $$
    select public.bootstrap_seller_account(
      '00000000-0000-0000-0000-000000008102',
      'GH', 'Unverified Seller', '+233241234598'
    )
  $$,
  '42501',
  null,
  'bootstrap_seller_account raises when neither email nor phone is verified'
);

-- An unconfirmed email on a phone-verified user must NOT be treated as
-- verified — contact_email must stay null, not leak the unconfirmed address.
insert into auth.users (
  id, instance_id, aud, role, email, phone, encrypted_password,
  email_confirmed_at, phone_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000008103',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'unconfirmed-email@example.com', '+233241234597', '',
  null, now(), '{}'::jsonb, now(), now()
);
select public.bootstrap_seller_account(
  '00000000-0000-0000-0000-000000008103',
  'GH', 'Mixed Verification Seller', '+233241234597'
);
select is(
  (select contact_email from public.seller_accounts where auth_user_id = '00000000-0000-0000-0000-000000008103'),
  null,
  'an unconfirmed email is never used as contact_email, even when phone is verified'
);

select * from finish();
rollback;
```

- [ ] **Step 5: Run the pgTAP suite**

Run: `pnpm db:reset && pnpm db:test`
Expected: `014_auth_otp.test.sql .. ok` in the output; only the known pre-existing unrelated `001_core.test.sql` plan-versioning failure remains (not caused by this task).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202607190033_auth_otp.sql supabase/tests/database/014_auth_otp.test.sql
git commit -m "feat: allow seller onboarding with a verified phone in place of email"
```

---

### Task 3: `onboarding.ts` — optional `contactEmail`

**Files:**
- Modify: `src/lib/auth/onboarding.ts`
- Modify: `src/lib/auth/onboarding.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `OnboardingFacts.seller.contactEmail: string | null` (was `string`); `parseAccountSetup(input, verifiedEmail: string | null)` now succeeds with `contactEmail: null` when `verifiedEmail` is `null` — consumed by Task 4 (`onboarding/actions.ts`, `onboarding/page.tsx` read path).

- [ ] **Step 1: Read the current test file to see existing conventions**

Run: `cat src/lib/auth/onboarding.test.ts | head -60`
Expected: confirms the existing `describe`/`it` structure for `parseAccountSetup` and `evaluateOnboarding` so the new tests below match it.

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/auth/onboarding.test.ts`:

```ts
describe("parseAccountSetup with no verified email", () => {
  it("succeeds with a null contactEmail when verifiedEmail is null", () => {
    const result = parseAccountSetup(
      { country: "GH", contactName: "Ama Serwaa", contactPhone: "0241234567" },
      null,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contactEmail).toBeNull();
      expect(result.data.contactPhone).toBe("+233241234567");
    }
  });
});

describe("evaluateOnboarding account milestone with no email", () => {
  it("treats the account milestone as complete when contactEmail is null but name and phone are present", () => {
    const state = evaluateOnboarding(
      {
        seller: { country: "GH", contactName: "Ama Serwaa", contactEmail: null, contactPhone: "+233241234567" },
        shop: null,
        policyAccepted: false,
        verificationState: "not_started",
        paymentSubaccountActive: false,
      },
      {
        firstProduct: { available: false, complete: false },
        fulfillment: { available: false, complete: false },
      },
    );
    const account = state.milestones.find((m) => m.key === "account");
    expect(account?.complete).toBe(true);
  });

  it("still requires contactPhone even when contactEmail is present", () => {
    const state = evaluateOnboarding(
      {
        seller: { country: "GH", contactName: "Ama Serwaa", contactEmail: "ama@example.com", contactPhone: null },
        shop: null,
        policyAccepted: false,
        verificationState: "not_started",
        paymentSubaccountActive: false,
      },
      {
        firstProduct: { available: false, complete: false },
        fulfillment: { available: false, complete: false },
      },
    );
    const account = state.milestones.find((m) => m.key === "account");
    expect(account?.complete).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/auth/onboarding.test.ts`
Expected: FAIL — the first new test fails because `contactEmail` is currently required by `accountSetupSchema` (rejects `verifiedEmail: null`); type errors may also appear once `OnboardingFacts.seller.contactEmail` is still typed as `string`.

- [ ] **Step 4: Update `src/lib/auth/onboarding.ts`**

Change the `OnboardingFacts` type:

```ts
export type OnboardingFacts = {
  seller: {
    country: CountryCode;
    contactName: string;
    contactEmail: string | null;
    contactPhone: string | null;
  } | null;
```

Change `accountComplete` in `evaluateOnboarding` — drop the email requirement, keep name and phone:

```ts
  const accountComplete =
    facts.seller !== null &&
    hasText(facts.seller.contactName) &&
    hasText(facts.seller.contactPhone);
```

Change `accountSetupSchema`'s `contactEmail` field to nullable:

```ts
const accountSetupSchema = z.object({
  country: z.enum(["GH", "NG", "CI"]),
  contactName: z.string().trim().min(2, "Enter your contact name."),
  contactEmail: z.email("Use the verified email on your account.").nullable(),
  contactPhone: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/, "Enter a valid phone number."),
});
```

Change `parseAccountSetup`'s mapping from empty-string-fallback to a real `null`:

```ts
export function parseAccountSetup(
  input: {
    country: string;
    contactName: string;
    contactPhone: string;
  },
  verifiedEmail: string | null,
): FieldParseResult<z.infer<typeof accountSetupSchema>> {
  return fieldResult(
    accountSetupSchema.safeParse({
      country: input.country,
      contactName: input.contactName,
      contactEmail: verifiedEmail ? verifiedEmail.trim().toLowerCase() : null,
      contactPhone:
        input.country === "GH" || input.country === "NG" || input.country === "CI"
          ? normalizePhoneNumber(input.contactPhone, input.country)
          : input.contactPhone,
    }),
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/auth/onboarding.test.ts`
Expected: PASS — all tests (existing + 3 new) green.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean. This codebase does not use generated Supabase types (no `Database` generic on the client), so there is no schema-derived type to reconcile — `OnboardingFacts.seller.contactEmail: string | null` and `page.tsx`'s existing read of `seller.contact_email` (already typed loosely) compose without friction.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/onboarding.ts src/lib/auth/onboarding.test.ts
git commit -m "feat: make contactEmail optional in onboarding facts and validation"
```

---

### Task 4: Relax the two onboarding read/write sites

**Files:**
- Modify: `src/app/(seller)/onboarding/actions.ts:189-197` (the `saveAccountAction` update — already null-safe once Task 3 lands, verify only)
- Modify: `src/app/(seller)/onboarding/page.tsx:215-223`
- Modify: `src/app/(seller)/onboarding/page.test.tsx`

**Interfaces:**
- Consumes: `parseAccountSetup`'s relaxed `contactEmail: string | null` return from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Verify `onboarding/actions.ts` needs no change**

Read `src/app/(seller)/onboarding/actions.ts` lines 180-208 (the `saveAccountAction` function). Confirm the `.update({ contact_email: parsed.data.contactEmail, ... })` call already accepts `string | null` for `contact_email` without a type error, since Supabase's generated types mark a nullable column as `string | null` on write — Task 3 already changed `parsed.data.contactEmail`'s type to match. No code change needed here; this step is verification only.

- [ ] **Step 2: Write the failing test for the onboarding page's verification gate**

Read `src/app/(seller)/onboarding/page.test.tsx` first to see how the `unprovisioned` actor state and `supabase.auth.getUser()` are currently mocked, then add a test matching that exact mocking convention:

```tsx
it("does not block onboarding for a phone-verified user with no confirmed email", async () => {
  mocks.resolveServerActor.mockResolvedValue({
    kind: "unprovisioned",
    authenticated: true,
    userId: "u1",
    email: null,
  });
  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { email_confirmed_at: null, phone_confirmed_at: "2026-07-19T00:00:00Z" } },
      }),
    },
  });

  const page = await OnboardingPage();
  render(page);

  expect(screen.queryByText("Verify your email")).not.toBeInTheDocument();
});
```

(Adapt the exact `render`/import style to match whatever the existing test file already uses for rendering `OnboardingPage`'s server-component output — check the file's existing `it("shows a verify-your-email message...")`-style test, if one exists, and mirror its structure exactly rather than inventing a new pattern.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run "src/app/(seller)/onboarding/page.test.tsx"`
Expected: FAIL — the current gate (`!user?.email_confirmed_at`) blocks this phone-verified user, so `"Verify your email"` IS present, and the `expect(...).not.toBeInTheDocument()` assertion fails.

- [ ] **Step 4: Fix the gate in `onboarding/page.tsx`**

Change:

```ts
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email_confirmed_at) {
      return statePage(
        "Verify your email",
        "We sent a confirmation link to your email address. Click it to continue setting up your shop.",
      );
    }
```

to:

```ts
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email_confirmed_at && !user?.phone_confirmed_at) {
      return statePage(
        "Verify your account",
        "We sent a 6-digit code to your email or phone. Enter it on the sign-in page to continue setting up your shop.",
      );
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run "src/app/(seller)/onboarding/page.test.tsx"`
Expected: PASS — the new test is green, and all pre-existing tests in this file still pass (an email-verified user is unaffected, since the `||`-style negated condition — `!A && !B` — is only false, i.e. does not block, when at least one of `A`/`B` is true, exactly matching the old behavior for email-verified users where `A` was already true).

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(seller\)/onboarding/page.tsx src/app/\(seller\)/onboarding/page.test.tsx
git commit -m "fix: let a phone-verified seller past onboarding's verification gate"
```

---

### Task 5: Login server actions — OTP send/verify/resend

**Files:**
- Modify: `src/app/(auth)/login/actions.ts` (full file replacement)
- Modify: `src/app/(auth)/login/actions.test.ts` (full file replacement)

**Interfaces:**
- Consumes: `classifyIdentifier` from `@/lib/auth/identifier` (Task 1).
- Produces: `sendOtpAction(formData): Promise<never>`, `verifyOtpAction(formData): Promise<never>`, `resendOtpAction(formData): Promise<never>` (form fields: `identifier`, `next`, and for verify: `code`) — consumed by Task 6 (`login/page.tsx`). `signInWithSocial`, `signOut` keep their existing signatures unchanged — consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/(auth)/login/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimitResult } from "@/lib/rate-limit";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  checkRateLimit: vi.fn((): RateLimitResult => ({ ok: true })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

import { resendOtpAction, sendOtpAction, signInWithSocial, signOut, verifyOtpAction } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://snapduka.example";
  process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = "true";
  mocks.checkRateLimit.mockReturnValue({ ok: true as const });
});

describe("sendOtpAction", () => {
  it("sends an email OTP when the identifier is an email", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signInWithOtp } });

    await expect(
      sendOtpAction(formData({ identifier: "Seller@Example.com", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithOtp).toHaveBeenCalledWith({ email: "seller@example.com" });
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("step=code"),
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("identifier=seller%40example.com"),
    );
  });

  it("sends an SMS OTP when the identifier is a phone number", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signInWithOtp } });

    await expect(
      sendOtpAction(formData({ identifier: "+233241234567", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithOtp).toHaveBeenCalledWith({
      phone: "+233241234567",
      options: { channel: "sms" },
    });
  });

  it("rejects an identifier that is neither a valid email nor phone", async () => {
    await expect(
      sendOtpAction(formData({ identifier: "not valid", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("Enter+a+valid+email+address+or+phone+number"),
    );
  });

  it("blocks sending when the rate limit is exceeded", async () => {
    mocks.checkRateLimit.mockReturnValue({ ok: false, retryAfterMs: 30_000 } satisfies RateLimitResult);

    await expect(
      sendOtpAction(formData({ identifier: "seller@example.com", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("Too+many+attempts"));
  });
});

describe("verifyOtpAction", () => {
  it("verifies an email code and redirects to next on success", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { verifyOtp } });

    await expect(
      verifyOtpAction(
        formData({ identifier: "seller@example.com", code: "123456", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    expect(verifyOtp).toHaveBeenCalledWith({
      email: "seller@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("verifies a phone code with type sms", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { verifyOtp } });

    await expect(
      verifyOtpAction(
        formData({ identifier: "+233241234567", code: "654321", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    expect(verifyOtp).toHaveBeenCalledWith({
      phone: "+233241234567",
      token: "654321",
      type: "sms",
    });
  });

  it("redirects back to the code step with an error on an invalid code", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: new Error("invalid") });
    mocks.createClient.mockResolvedValue({ auth: { verifyOtp } });

    await expect(
      verifyOtpAction(
        formData({ identifier: "seller@example.com", code: "000000", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("That+code+is+invalid+or+has+expired"),
    );
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("step=code"));
  });

  it("rejects a code that is not 6 digits without calling Supabase", async () => {
    await expect(
      verifyOtpAction(
        formData({ identifier: "seller@example.com", code: "123", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("blocks verification when the rate limit is exceeded", async () => {
    mocks.checkRateLimit.mockReturnValue({ ok: false, retryAfterMs: 60_000 } satisfies RateLimitResult);

    await expect(
      verifyOtpAction(
        formData({ identifier: "seller@example.com", code: "123456", next: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("resendOtpAction", () => {
  it("resends a code and redirects back to the code step with a confirmation message", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signInWithOtp } });

    await expect(
      resendOtpAction(formData({ identifier: "seller@example.com", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithOtp).toHaveBeenCalledWith({ email: "seller@example.com" });
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("step=code"));
  });

  it("blocks resend when the rate limit is exceeded", async () => {
    mocks.checkRateLimit.mockReturnValue({ ok: false, retryAfterMs: 90_000 } satisfies RateLimitResult);

    await expect(
      resendOtpAction(formData({ identifier: "seller@example.com", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("signInWithSocial", () => {
  it("starts an enabled social sign-in with a safe callback URL", async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({
      data: { url: "https://accounts.google.com/oauth" },
      error: null,
    });
    mocks.createClient.mockResolvedValue({ auth: { signInWithOAuth } });

    await expect(
      signInWithSocial(formData({ provider: "google", next: "//evil.example" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://snapduka.example/auth/confirm?next=%2F" },
    });
    expect(mocks.redirect).toHaveBeenCalledWith("https://accounts.google.com/oauth");
  });

  it("rejects social providers that are not enabled", async () => {
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = "false";

    await expect(
      signInWithSocial(formData({ provider: "google", next: "/dashboard" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("signs out and returns to login", async () => {
    const signOutFromSupabase = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signOut: signOutFromSupabase } });

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");

    expect(signOutFromSupabase).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run "src/app/(auth)/login/actions.test.ts"`
Expected: FAIL — `sendOtpAction`/`verifyOtpAction`/`resendOtpAction` are not exported yet.

- [ ] **Step 3: Replace `src/app/(auth)/login/actions.ts` in full**

```ts
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { appOrigin } from "@/lib/app-url";
import { classifyIdentifier } from "@/lib/auth/identifier";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSocialProviderEnabled } from "@/lib/auth/social";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const socialProviderSchema = z.enum(["google", "facebook", "apple"]);
const codeSchema = z.string().regex(/^[0-9]{6}$/, "Enter the 6-digit code.");

// ---------------------------------------------------------------------------
// Rate-limit configs
// ---------------------------------------------------------------------------

const SEND_OTP_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };    //  5 / 15 min
const VERIFY_OTP_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 };  //  8 / 15 min
const RESEND_OTP_LIMIT = { limit: 3, windowMs: 15 * 60 * 1000 };  //  3 / 15 min
const SOCIAL_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };     // 10 / 15 min

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  } catch {
    return "unknown";
  }
}

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function authNextPath(value: string): string {
  return safeNextPath(value || "/onboarding");
}

async function confirmationUrl(next: string): Promise<string> {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!configuredUrl) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_APP_URL");
  }
  const appUrl = new URL(configuredUrl);
  if (appUrl.protocol !== "https:" && appUrl.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use http or https.");
  }
  // In development the live request origin wins so the OAuth redirect
  // points at the port the app is actually running on.
  const origin = await appOrigin();
  const confirmUrl = new URL("/auth/confirm", origin);
  confirmUrl.searchParams.set("next", next);
  return confirmUrl.toString();
}

function loginRedirect(kind: "error" | "message", text: string, next: string): never {
  const searchParams = new URLSearchParams({ [kind]: text, next });
  redirect(`/login?${searchParams.toString()}`);
}

function toCodeStep(identifier: string, next: string, kind: "error" | "message", text: string): never {
  const searchParams = new URLSearchParams({ step: "code", identifier, next, [kind]: text });
  redirect(`/login?${searchParams.toString()}`);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function sendOtpAction(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const ip = await clientIp();

  const rl = checkRateLimit(`auth:send-otp:${ip}`, SEND_OTP_LIMIT);
  if (!rl.ok) {
    const waitSec = Math.ceil(rl.retryAfterMs / 1000);
    loginRedirect("error", `Too many attempts. Try again in ${waitSec} seconds.`, next);
  }

  const identifier = classifyIdentifier(formValue(formData, "identifier"));
  if (identifier.kind === "invalid") {
    loginRedirect("error", "Enter a valid email address or phone number.", next);
  }

  const supabase = await createClient();
  const { error } =
    identifier.kind === "email"
      ? await supabase.auth.signInWithOtp({ email: identifier.value })
      : await supabase.auth.signInWithOtp({ phone: identifier.value, options: { channel: "sms" } });

  if (error) {
    loginRedirect("error", "We could not send a code. Please try again.", next);
  }

  toCodeStep(
    identifier.value,
    next,
    "message",
    identifier.kind === "email" ? "We sent a 6-digit code to your email." : "We sent a 6-digit code by SMS.",
  );
}

export async function verifyOtpAction(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const rawIdentifier = formValue(formData, "identifier");
  const ip = await clientIp();

  const rl = checkRateLimit(`auth:verify-otp:${ip}`, VERIFY_OTP_LIMIT);
  if (!rl.ok) {
    const waitSec = Math.ceil(rl.retryAfterMs / 1000);
    toCodeStep(rawIdentifier, next, "error", `Too many attempts. Try again in ${waitSec} seconds.`);
  }

  const identifier = classifyIdentifier(rawIdentifier);
  const parsedCode = codeSchema.safeParse(formValue(formData, "code").trim());

  if (identifier.kind === "invalid" || !parsedCode.success) {
    toCodeStep(rawIdentifier, next, "error", "Enter the 6-digit code.");
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

export async function resendOtpAction(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const rawIdentifier = formValue(formData, "identifier");
  const ip = await clientIp();

  const rl = checkRateLimit(`auth:resend-otp:${ip}`, RESEND_OTP_LIMIT);
  if (!rl.ok) {
    const waitSec = Math.ceil(rl.retryAfterMs / 1000);
    toCodeStep(rawIdentifier, next, "error", `Too many attempts. Try again in ${waitSec} seconds.`);
  }

  const identifier = classifyIdentifier(rawIdentifier);
  if (identifier.kind === "invalid") {
    loginRedirect("error", "Enter a valid email address or phone number.", next);
  }

  const supabase = await createClient();
  const { error } =
    identifier.kind === "email"
      ? await supabase.auth.signInWithOtp({ email: identifier.value })
      : await supabase.auth.signInWithOtp({ phone: identifier.value, options: { channel: "sms" } });

  if (error) {
    toCodeStep(identifier.value, next, "error", "We could not resend the code. Please try again.");
  }

  toCodeStep(
    identifier.value,
    next,
    "message",
    identifier.kind === "email" ? "We sent a new code to your email." : "We sent a new code by SMS.",
  );
}

export async function signInWithSocial(formData: FormData): Promise<never> {
  const next = authNextPath(formValue(formData, "next"));
  const ip = await clientIp();

  const rl = checkRateLimit(`auth:social:${ip}`, SOCIAL_LIMIT);
  if (!rl.ok) {
    loginRedirect("error", "Too many requests. Please wait before trying again.", next);
  }

  const parsedProvider = socialProviderSchema.safeParse(formValue(formData, "provider"));
  if (!parsedProvider.success || !isSocialProviderEnabled(parsedProvider.data)) {
    loginRedirect("error", "That social sign-in option is not available.", next);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: parsedProvider.data,
    options: { redirectTo: await confirmationUrl(next) },
  });

  if (error || !data.url) {
    loginRedirect("error", "We could not start social sign-in. Please try again.", next);
  }

  redirect(data.url);
}

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    loginRedirect("error", "We could not sign you out. Please try again.", "/");
  }

  redirect("/login");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run "src/app/(auth)/login/actions.test.ts"`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: FAILS at this point — `login/page.tsx` still imports the now-removed `signIn`/`signUp`/`signInWithMagicLink`. This is expected and resolved by Task 6.

- [ ] **Step 6: Lint**

Run: `pnpm lint`
Expected: clean for `actions.ts`/`actions.test.ts` themselves (the `login/page.tsx` typecheck failure does not block lint on files that don't import it, but if lint also fails due to the same cross-file import, that's expected too and resolved by Task 6).

- [ ] **Step 7: Commit**

```bash
git add src/app/\(auth\)/login/actions.ts src/app/\(auth\)/login/actions.test.ts
git commit -m "feat: replace password login with unified email/phone OTP actions"
```

---

### Task 6: `login/page.tsx` — identifier + code-entry screens

**Files:**
- Modify: `src/app/(auth)/login/page.tsx` (full file replacement)
- Modify: `src/app/(auth)/login/page.test.tsx`

**Interfaces:**
- Consumes: `sendOtpAction`, `verifyOtpAction`, `resendOtpAction`, `signInWithSocial` from `./actions` (Task 5).
- Produces: nothing consumed by later tasks — this is the feature's final visible wiring. Removes the `PasswordStrengthInput` import (deleted in Task 7).

- [ ] **Step 1: Read the current test file to see existing conventions**

Run: `cat "src/app/(auth)/login/page.test.tsx"`
Expected: shows the current render/assertion style for this Server Component page (likely rendering the awaited JSX and checking for form fields/text) — match this exact pattern for the new tests below.

- [ ] **Step 2: Write the failing tests**

Replace the content of `src/app/(auth)/login/page.test.tsx` with (adapt import paths/mocking to match exactly what the file already used for `isSocialProviderEnabled`/environment setup — keep those parts, only change the assertions to match the new single-identifier-field UI):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LoginPage from "./page";

describe("LoginPage", () => {
  it("shows a single identifier field and no password field on the default step", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });
    render(page);

    expect(screen.getByLabelText(/email or phone number/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send me a code/i })).toBeInTheDocument();
  });

  it("shows the code-entry screen when step=code", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({ step: "code", identifier: "seller@example.com", next: "/dashboard" }),
    });
    render(page);

    expect(screen.getByLabelText(/6-digit code/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /verify and continue/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resend code/i })).toBeInTheDocument();
  });

  it("renders a message banner on the code step", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({
        step: "code",
        identifier: "seller@example.com",
        next: "/dashboard",
        message: "We sent a 6-digit code to your email.",
      }),
    });
    render(page);

    expect(screen.getByRole("status")).toHaveTextContent("We sent a 6-digit code to your email.");
  });

  it("renders an error banner", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({ error: "That code is invalid or has expired." }),
    });
    render(page);

    expect(screen.getByRole("alert")).toHaveTextContent("That code is invalid or has expired.");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run "src/app/(auth)/login/page.test.tsx"`
Expected: FAIL — the current page has separate email/password fields, not a single identifier field, and no code-entry step.

- [ ] **Step 4: Replace `src/app/(auth)/login/page.tsx` in full**

```tsx
import type { Metadata } from "next";
import Link from "next/link";

import { LogoMark } from "@/components/ui/logo";
import { Req } from "@/components/ui/required-mark";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSocialProviderEnabled } from "@/lib/auth/social";

import { resendOtpAction, sendOtpAction, signInWithSocial, verifyOtpAction } from "./actions";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = {
  title: "Sign in | SnapDuka",
};

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    message?: string | string[];
    next?: string | string[];
    step?: string | string[];
    identifier?: string | string[];
  }>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const INPUT_CLASSES =
  "h-[46px] w-full rounded-[10px] border border-line-input bg-white px-3.5 text-[14.5px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)]";

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next) ?? "/onboarding");
  const error = first(params.error);
  const message = first(params.message);
  const isCodeStep = first(params.step) === "code";
  const identifier = first(params.identifier) ?? "";
  const googleEnabled = isSocialProviderEnabled("google");

  return (
    <main className="sd-main flex min-h-svh flex-col bg-paper text-ink">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-[60px] max-w-[1120px] items-center px-5">
          <Link
            href="/"
            aria-label="SnapDuka home"
            className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-ink"
          >
            <LogoMark className="h-[26px] w-[26px] rounded-lg text-[15px]" />
            SnapDuka
          </Link>
        </div>
      </header>

      <div className="grid flex-1 place-items-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <h1 className="mb-2 font-serif text-[clamp(26px,3.4vw,32px)] font-medium tracking-[-0.01em]">
            {isCodeStep ? "Enter your code" : "Sign in or create an account"}
          </h1>
          <p className="mb-6.5 text-[14px] leading-[1.6] text-ink-soft">
            {isCodeStep
              ? "We sent a 6-digit code — enter it below to continue."
              : "One account for your storefront, orders and payouts. Enter your email or phone — no password needed."}
          </p>

          {error ? (
            <div
              role="alert"
              className="mb-4 flex gap-2.5 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3"
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="mt-px shrink-0">
                <path d="M9 6.5v3.2m0 2.6h.01M9 2 1.8 15h14.4L9 2Z" stroke="#B42318" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-[12.5px] leading-[1.5] text-[#7A1B10]">
                <strong className="font-bold">That didn&rsquo;t work.</strong> {error}
              </p>
            </div>
          ) : null}
          {message ? (
            <div
              role="status"
              className="mb-4 rounded-[10px] border border-line bg-white px-3.5 py-3 text-[13px] text-ink-soft"
            >
              {message}
            </div>
          ) : null}

          {isCodeStep ? (
            <>
              <form action={verifyOtpAction} className="grid gap-3.5">
                <input name="next" type="hidden" value={next} />
                <input name="identifier" type="hidden" value={identifier} />
                <label className="grid gap-1.5 text-[12.5px] font-semibold" htmlFor="auth-code">
                  <span>6-digit code<Req /></span>
                  <input
                    autoComplete="one-time-code"
                    className={INPUT_CLASSES}
                    id="auth-code"
                    inputMode="numeric"
                    maxLength={6}
                    name="code"
                    pattern="[0-9]{6}"
                    placeholder="123456"
                    required
                    type="text"
                  />
                </label>
                <SubmitButton
                  className="h-[50px] cursor-pointer rounded-[11px] border-none bg-accent text-[15px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
                  pendingLabel="Verifying…"
                >
                  Verify and continue
                </SubmitButton>
              </form>
              <div className="mt-4 flex items-center justify-between text-[12.5px]">
                <form action={resendOtpAction}>
                  <input name="next" type="hidden" value={next} />
                  <input name="identifier" type="hidden" value={identifier} />
                  <button
                    type="submit"
                    className="cursor-pointer border-none bg-transparent p-0 font-semibold text-accent underline hover:text-accent-deep"
                  >
                    Resend code
                  </button>
                </form>
                <Link
                  href={`/login?${new URLSearchParams({ next })}`}
                  className="font-semibold text-ink-soft underline hover:text-ink"
                >
                  Use a different email or phone
                </Link>
              </div>
            </>
          ) : (
            <>
              <form action={sendOtpAction} className="grid gap-3.5">
                <input name="next" type="hidden" value={next} />
                <label className="grid gap-1.5 text-[12.5px] font-semibold" htmlFor="auth-identifier">
                  <span>Email or phone number<Req /></span>
                  <input
                    autoComplete="username"
                    className={INPUT_CLASSES}
                    id="auth-identifier"
                    name="identifier"
                    placeholder="you@example.com or +233201234567"
                    required
                    type="text"
                  />
                </label>
                <SubmitButton
                  className="h-[50px] cursor-pointer rounded-[11px] border-none bg-accent text-[15px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
                  pendingLabel="Sending code…"
                >
                  Send me a code
                </SubmitButton>
              </form>

              {googleEnabled ? (
                <>
                  <div className="my-4 flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-line" />
                    <span className="text-[11.5px] font-semibold text-ink-faint">OR</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                  <form action={signInWithSocial}>
                    <input name="next" type="hidden" value={next} />
                    <input name="provider" type="hidden" value="google" />
                    <SubmitButton
                      className="inline-flex h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] border border-line-strong bg-white text-[13.5px] font-semibold text-ink transition-colors hover:border-[#B9AC98] disabled:cursor-wait disabled:opacity-60"
                      pendingLabel="Connecting to Google…"
                    >
                      <GoogleIcon />
                      Continue with Google
                    </SubmitButton>
                  </form>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run "src/app/(auth)/login/page.test.tsx"`
Expected: PASS — all 4 tests green.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean — this resolves the cross-file typecheck failures noted in Task 5.

- [ ] **Step 7: Manually verify in the browser**

Run: `pnpm dev:local`, open `/login`. Confirm: a single "Email or phone number" field, a "Send me a code" button, no password field anywhere, a "Continue with Google" button below it (assuming Google is enabled locally). Enter an email, submit, confirm redirect to the code-entry screen with a "We sent a 6-digit code to your email" message and a 6-digit code input. Check the local Inbucket inbox (`http://127.0.0.1:54324`) for the email and confirm it shows a plain numeric code, not (only) a clickable link.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(auth\)/login/page.tsx src/app/\(auth\)/login/page.test.tsx
git commit -m "feat: replace login form with unified email/phone OTP flow"
```

---

### Task 7: Delete `PasswordStrengthInput`

**Files:**
- Delete: `src/components/ui/password-strength.tsx`
- Modify: `src/components/ui/ui-kit.test.tsx` (only if it references `PasswordStrengthInput` — verify first)

**Interfaces:**
- Consumes: nothing (Task 6 already removed the only import of this component).
- Produces: nothing.

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rln "PasswordStrengthInput\|password-strength" --include="*.tsx" --include="*.ts" src/`
Expected: no matches (Task 6's replacement of `login/page.tsx` already removed the only import).

- [ ] **Step 2: Delete the component file**

```bash
git rm src/components/ui/password-strength.tsx
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass — no test file should have been exercising this component in isolation (confirmed by Step 1's grep).

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: delete unused PasswordStrengthInput component"
```

---

### Task 8: `auth/confirm/route.ts` — OAuth-only

**Files:**
- Modify: `src/app/auth/confirm/route.ts` (full file replacement)
- Modify: `src/app/auth/confirm/route.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks — this route no longer handles email-OTP verification (that now happens via the typed-code `verifyOtpAction` in Task 5), only the Google OAuth `code` exchange.

- [ ] **Step 1: Read the current test file**

Run: `cat src/app/auth/confirm/route.test.ts`
Expected: shows tests for both the `code` branch (OAuth) and the `token_hash`/`type` branch (email OTP link) — the latter must be removed in this task since that verification path no longer exists.

- [ ] **Step 2: Write/update the tests**

Replace `src/app/auth/confirm/route.test.ts`'s content, keeping every existing test for the `code` branch exactly as-is, and removing every test that exercises `token_hash`/`type` (email-OTP-link verification). Add one new test confirming a request with only `token_hash`/`type` (no `code`) is now treated as an invalid confirmation:

```ts
it("treats a token_hash-only request as invalid now that OTP links are not supported", async () => {
  mocks.createClient.mockResolvedValue({
    auth: { exchangeCodeForSession: vi.fn() },
  });

  const request = new NextRequest(
    "https://snapduka.example/auth/confirm?token_hash=abc123&type=email&next=%2Fonboarding",
  );
  const response = await GET(request);

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toContain("/login");
  expect(response.headers.get("location")).toContain("invalid+or+has+expired");
});
```

(Match the exact `NextRequest` construction and `GET` import style the existing test file already uses.)

- [ ] **Step 3: Run tests to verify the new test fails**

Run: `pnpm vitest run src/app/auth/confirm/route.test.ts`
Expected: FAIL on the new test — the current route still has a `token_hash`/`type` branch that would succeed for this request.

- [ ] **Step 4: Replace `src/app/auth/confirm/route.ts` in full**

```ts
import { type NextRequest, NextResponse } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const next = safeNextPath(
    request.nextUrl.searchParams.get("next") ?? "/onboarding",
  );
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await createClient();

  let confirmed = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    confirmed = !error;
  }

  if (confirmed) {
    return NextResponse.redirect(new URL(next, request.url));
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "error",
    "This confirmation link is invalid or has expired.",
  );
  loginUrl.searchParams.set("next", next);

  return NextResponse.redirect(loginUrl);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/app/auth/confirm/route.test.ts`
Expected: PASS — all tests (the retained `code`-branch tests plus the new test) green.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/auth/confirm/route.ts src/app/auth/confirm/route.test.ts
git commit -m "refactor: make auth/confirm OAuth-only now that OTP uses typed codes"
```

---

### Task 9: Twilio SMS provider configuration

**Files:**
- Modify: `supabase/config.toml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: local `supabase start` reads Twilio credentials from the environment — this only covers local dev; the equivalent Phone/Twilio provider must also be configured in the Supabase Cloud dashboard for the production project, since Cloud does not read `config.toml`. Real credentials must be supplied by the user before phone OTP can be tested end-to-end (local or production).

- [ ] **Step 1: Update `supabase/config.toml`**

Change:

```toml
[auth.sms]
enable_signup = false
enable_confirmations = false
```

to:

```toml
[auth.sms]
enable_signup = true
enable_confirmations = false
max_frequency = "10s"

# Twilio SMS provider. Credentials come from the environment running
# `supabase start` — export TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
# TWILIO_MESSAGE_SERVICE_SID (or keep them in a shell profile). This only
# covers local development — the equivalent Phone provider must also be
# configured in the Supabase Cloud dashboard (Authentication → Providers →
# Phone) for the production project, since Cloud does not read this file.
[auth.sms.twilio]
enabled = true
account_sid = "env(TWILIO_ACCOUNT_SID)"
auth_token = "env(TWILIO_AUTH_TOKEN)"
message_service_sid = "env(TWILIO_MESSAGE_SERVICE_SID)"
```

- [ ] **Step 2: Update `.env.example`**

Add after the `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED` block:

```
# SMS OTP login (Twilio). Required for `supabase start` to send real SMS
# codes locally. Also configure the equivalent Phone provider in the
# Supabase Cloud dashboard (Authentication → Providers → Phone) for
# production — Cloud does not read supabase/config.toml.
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGE_SERVICE_SID=
```

- [ ] **Step 3: Confirm the local stack still starts without real credentials**

Run: `supabase status`
Expected: if the stack is already running, it stays healthy — `config.toml` changes only take effect on the next `supabase start`/`db reset` and an unset `env(...)` reference does not crash the CLI, it just leaves that provider inert (SMS send attempts will fail until real credentials are exported, which is expected and documented in the plan's Global Constraints).

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml .env.example
git commit -m "feat: wire Twilio as the local SMS OTP provider"
```

---

### Task 10: Custom OTP email template (typed code, no link)

**Files:**
- Create: `supabase/templates/magic_link.html`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: nothing.
- Produces: Supabase's default email-OTP template (which shows a clickable link) is replaced with one that shows only the 6-digit code — required because Task 8 removed the link-based verification path entirely, and Task 5's `sendOtpAction` no longer passes `emailRedirectTo`.

- [ ] **Step 1: Create the template**

```html
<!-- supabase/templates/magic_link.html -->
<h2>Your SnapDuka sign-in code</h2>
<p>Enter this code on the sign-in page to continue:</p>
<p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; font-family: monospace;">{{ .Token }}</p>
<p>This code expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
```

- [ ] **Step 2: Register it in `supabase/config.toml`**

Add under the `[auth.email]` section:

```toml
[auth.email]
enable_signup = true
enable_confirmations = false

[auth.email.template.magic_link]
subject = "Your SnapDuka sign-in code"
content_path = "./supabase/templates/magic_link.html"
```

- [ ] **Step 3: Apply and manually verify**

Run: `pnpm db:reset` (restarts the auth service so the template change is picked up), then `pnpm dev:local`, open `/login`, send a code to a test email address, and check the local Inbucket inbox (`http://127.0.0.1:54324`). Confirm the email shows the custom subject line and a large 6-digit numeric code, with no clickable "confirm" link presented as the primary call to action.

- [ ] **Step 4: Commit**

```bash
git add supabase/templates/magic_link.html supabase/config.toml
git commit -m "feat: show a typed 6-digit code in the OTP email instead of a magic link"
```

---

### Task 11: Full verification pass

**Files:** none — this task runs checks across everything built in Tasks 1–10.

- [ ] **Step 1: Run the full automated test suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: typecheck clean, lint clean, all vitest suites pass (including the new `identifier.test.ts`, updated `onboarding.test.ts`, rewritten `login/actions.test.ts` and `login/page.test.tsx`, updated `onboarding/page.test.tsx` and `auth/confirm/route.test.ts`).

- [ ] **Step 2: Run the pgTAP suite**

Run: `pnpm db:reset && pnpm db:test`
Expected: `014_auth_otp.test.sql .. ok`; no new failures beyond the known pre-existing, unrelated `001_core.test.sql` plan-versioning issue.

- [ ] **Step 3: Manual end-to-end pass on local dev**

Run: `pnpm dev:local`.
1. Sign up with an email-only identifier via OTP. Confirm onboarding completes without ever seeing a password field, and that `seller_accounts.contact_email` is populated from the verified email.
2. If real Twilio credentials have been supplied by this point, sign up with a phone-only identifier via OTP. Confirm `bootstrap_seller_account` succeeds with `contact_email = null`, and onboarding's verification gate (Task 4) does not block a phone-verified user. If real Twilio credentials are not yet available, skip this step and note it as untested rather than guessing at the result.
3. Confirm Google sign-in still works unchanged (click "Continue with Google", complete the flow, land on `next`).
4. Confirm a wrong/expired code shows "That code is invalid or has expired." on the code-entry screen without losing the identifier (the form should not force the user back to step 1).
5. Confirm "Resend code" sends a new code and shows a confirmation message.

- [ ] **Step 4: Report results**

No commit for this task — it's verification only. If any check fails, return to the relevant task above and fix before considering the plan complete.
