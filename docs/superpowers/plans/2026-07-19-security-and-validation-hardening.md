# Security & Country-Aware Validation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make phone/email validation genuinely country-aware (Ghana/Nigeria/Côte d'Ivoire), close a real SSRF hole and a real over-refund gap, add rate limiting where it's missing, and harden a batch of weak form validations — following a full audit that already found and fixed two stored-XSS bugs this session.

**Architecture:** A single shared per-country phone-validation module (`src/lib/countries/phone.ts`) becomes the one source of truth for exact digit counts per country, replacing four separate ad-hoc regexes. Security fixes are independent, narrowly-scoped patches to the specific files the audit identified — no framework changes, no new external dependencies except where explicitly noted as out of scope (a real distributed rate-limit store).

**Tech Stack:** Next.js Server Actions, zod, Supabase Postgres.

## Global Constraints

- No live users exist — no backward-compatible data migration needed for schema changes.
- The existing in-memory rate limiter (`src/lib/rate-limit.ts`) is single-process and likely ineffective on Vercel's serverless deployment (confirmed via its own doc comment). Fixing this properly requires a shared store (e.g. Upstash Redis), which needs the user to provision an external account — **explicitly out of scope for this plan**. This plan only closes gaps in *which* endpoints call the existing limiter, not the limiter's underlying architecture.
- Every phone number in this codebase is normalized via `normalizePhoneNumber(input, country)` (`src/lib/auth/onboarding.ts`) before validation — the new shared validator checks the *normalized* `+<callingCode><digits>` shape, not raw user input.
- Migration files: check `ls supabase/migrations | tail -3` before writing Task 2 — this plan assumes the next number is `202607190034`; bump if a later migration already exists.
- pgTAP test files: check `ls supabase/tests/database | tail -3` before writing Task 2 — this plan assumes `015_contact_phone_country_check.test.sql`; bump if `015` is already taken.

---

### Task 1: Shared per-country phone validator

**Files:**
- Create: `src/lib/countries/phone.ts`
- Create: `src/lib/countries/phone.test.ts`

**Interfaces:**
- Produces: `isValidPhoneForCountry(normalizedPhone: string, country: CountryCode): boolean`, `phoneExampleFor(country: CountryCode): string` — consumed by Task 2 (onboarding), Task 3 (checkout), Task 4 (restock).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/countries/phone.test.ts
import { describe, expect, it } from "vitest";

import { isValidPhoneForCountry, phoneExampleFor } from "./phone";

describe("isValidPhoneForCountry", () => {
  it("accepts a 9-digit Ghana mobile number after +233", () => {
    expect(isValidPhoneForCountry("+233241234567", "GH")).toBe(true);
  });

  it("rejects a Ghana number with the wrong digit count", () => {
    expect(isValidPhoneForCountry("+23324123456", "GH")).toBe(false); // 8 digits
    expect(isValidPhoneForCountry("+2332412345678", "GH")).toBe(false); // 10 digits
  });

  it("accepts a 10-digit Nigeria mobile number after +234", () => {
    expect(isValidPhoneForCountry("+2348012345678", "NG")).toBe(true);
  });

  it("rejects a Nigeria number with the wrong digit count", () => {
    expect(isValidPhoneForCountry("+234801234567", "NG")).toBe(false); // 9 digits
  });

  it("accepts a 10-digit Côte d'Ivoire mobile number after +225", () => {
    expect(isValidPhoneForCountry("+2250708091011", "CI")).toBe(true);
  });

  it("rejects a Côte d'Ivoire number with the wrong digit count", () => {
    expect(isValidPhoneForCountry("+225070809101", "CI")).toBe(false); // 9 digits
  });

  it("rejects a number normalized for the wrong country's calling code", () => {
    expect(isValidPhoneForCountry("+234241234567", "GH")).toBe(false);
  });

  it("rejects garbage input instead of throwing", () => {
    expect(isValidPhoneForCountry("not a phone number", "GH")).toBe(false);
  });
});

describe("phoneExampleFor", () => {
  it("returns a plausible example per country", () => {
    expect(phoneExampleFor("GH")).toBe("+233241234567");
    expect(phoneExampleFor("NG")).toBe("+2348012345678");
    expect(phoneExampleFor("CI")).toBe("+2250708091011");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/countries/phone.test.ts`
Expected: FAIL — `Cannot find module './phone'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/countries/phone.ts
import type { CountryCode } from "./types";

/**
 * Exact local-digit counts for each country's mobile numbers, applied to
 * the already-normalized "+<callingCode><digits>" shape produced by
 * normalizePhoneNumber(). A shared 8-15-digit range (the old approach)
 * silently accepted wrong-length numbers for every country.
 */
const PHONE_RULES: Record<CountryCode, { callingCode: string; localDigits: number; example: string }> = {
  GH: { callingCode: "233", localDigits: 9, example: "+233241234567" },
  NG: { callingCode: "234", localDigits: 10, example: "+2348012345678" },
  CI: { callingCode: "225", localDigits: 10, example: "+2250708091011" },
};

function phonePatternFor(country: CountryCode): RegExp {
  const { callingCode, localDigits } = PHONE_RULES[country];
  return new RegExp(`^\\+${callingCode}\\d{${localDigits}}$`);
}

/** Validates an already-normalized phone number against the exact digit
 * count for the given country — not a shared cross-country length range. */
export function isValidPhoneForCountry(normalizedPhone: string, country: CountryCode): boolean {
  return phonePatternFor(country).test(normalizedPhone);
}

export function phoneExampleFor(country: CountryCode): string {
  return PHONE_RULES[country].example;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/countries/phone.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/countries/phone.ts src/lib/countries/phone.test.ts
git commit -m "feat: add shared per-country phone digit-count validator"
```

---

### Task 2: Country-exact phone validation in onboarding + matching DB constraint

**Files:**
- Modify: `src/lib/auth/onboarding.ts`
- Modify: `src/lib/auth/onboarding.test.ts`
- Create: `supabase/migrations/202607190034_contact_phone_country_check.sql`
- Create: `supabase/tests/database/015_contact_phone_country_check.test.sql`

**Interfaces:**
- Consumes: `isValidPhoneForCountry`, `phoneExampleFor` from `@/lib/countries/phone` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm the next migration/test numbers**

Run: `ls supabase/migrations | tail -3 && ls supabase/tests/database | tail -3`
Expected: confirms `202607190034` and `015` are free. If not, use the next free numbers.

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/auth/onboarding.test.ts`:

```ts
describe("parseAccountSetup with country-exact phone validation", () => {
  it("rejects a Ghana phone number with only 8 local digits", () => {
    const result = parseAccountSetup(
      { country: "GH", contactName: "Ama Serwaa", contactPhone: "0241234" },
      "ama@example.com",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors.contactPhone?.[0]).toContain("valid phone number");
    }
  });

  it("accepts a correctly-sized Nigeria phone number", () => {
    const result = parseAccountSetup(
      { country: "NG", contactName: "Chidi Okafor", contactPhone: "08012345678" },
      "chidi@example.com",
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contactPhone).toBe("+2348012345678");
    }
  });

  it("rejects a Nigeria phone number normalized to the Ghana digit count", () => {
    const result = parseAccountSetup(
      { country: "NG", contactName: "Chidi Okafor", contactPhone: "0801234567" },
      "chidi@example.com",
    );
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/auth/onboarding.test.ts`
Expected: FAIL — the current 8-15-digit generic regex accepts the too-short Ghana number.

- [ ] **Step 4: Update `src/lib/auth/onboarding.ts`**

Add the import:

```ts
import { isValidPhoneForCountry, phoneExampleFor } from "@/lib/countries/phone";
```

Change `accountSetupSchema` from:

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

to:

```ts
const accountSetupSchema = z
  .object({
    country: z.enum(["GH", "NG", "CI"]),
    contactName: z.string().trim().min(2, "Enter your contact name."),
    contactEmail: z.email("Use the verified email on your account.").nullable(),
    contactPhone: z.string(),
  })
  .refine((value) => isValidPhoneForCountry(value.contactPhone, value.country), {
    message: "Enter a valid phone number.",
    path: ["contactPhone"],
  });
```

Note: `contactPhone` is already normalized to `+<callingCode><digits>` shape by `parseAccountSetup` (below) *before* this schema validates it, so the refine can check the exact per-country pattern directly.

Update `parseAccountSetup` — it currently normalizes `contactPhone` as part of building the object passed to `safeParse`; keep that behavior, just confirm the field order still normalizes before validation (no functional change needed here beyond the schema itself, since normalization already happens inline in the object literal passed to `accountSetupSchema.safeParse(...)`). Re-read the current `parseAccountSetup` function body to confirm; it should already look like this (no edit needed if it matches):

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

If it doesn't match exactly (e.g. line numbers shifted), locate the function and confirm normalization happens before the `accountSetupSchema.safeParse` call — do not change the normalization logic itself, only the schema's validation rule as shown above.

`phoneExampleFor` is imported for potential future UI use but not required by this task's schema change — if lint flags it as unused, remove the import (only import what Step 4's final code actually uses).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/auth/onboarding.test.ts`
Expected: PASS — all tests (existing + 3 new) green.

- [ ] **Step 6: Write the migration**

```sql
-- supabase/migrations/202607190034_contact_phone_country_check.sql
-- The old contact_phone check (8-15 digit E.164 range) accepted a Ghana
-- number with the wrong local-digit count as long as it fell in that
-- shared range. Replace it with an exact per-country check matching the
-- app-layer validator in src/lib/countries/phone.ts: GH 9 local digits,
-- NG 10, CI 10.

alter table public.seller_accounts
  drop constraint seller_accounts_contact_phone_check;

alter table public.seller_accounts
  add constraint seller_accounts_contact_phone_check
  check (
    contact_phone is null
    or (country = 'GH' and contact_phone ~ '^\+233[0-9]{9}$')
    or (country = 'NG' and contact_phone ~ '^\+234[0-9]{10}$')
    or (country = 'CI' and contact_phone ~ '^\+225[0-9]{10}$')
  );
```

- [ ] **Step 7: Apply it locally and confirm it runs clean**

Run: `pnpm db:reset`
Expected: log shows `Applying migration 202607190034_contact_phone_country_check.sql...` with no error.

- [ ] **Step 8: Write the pgTAP test**

```sql
-- supabase/tests/database/015_contact_phone_country_check.test.sql
begin;

set local search_path = extensions, public;

select plan(4);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000009101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'phone-check@example.com', '',
  now(), '{}'::jsonb, now(), now()
);

select lives_ok(
  $$
    insert into public.seller_accounts (
      id, auth_user_id, country, status, is_active,
      contact_name, contact_email, contact_phone
    ) values (
      '00000000-0000-0000-0000-000000009201',
      '00000000-0000-0000-0000-000000009101',
      'GH', 'active', true, 'GH Seller', 'phone-check@example.com', '+233241234567'
    )
  $$,
  'a correctly-sized 9-digit Ghana number is accepted'
);

select throws_ok(
  $$
    update public.seller_accounts
    set contact_phone = '+23324123456'
    where id = '00000000-0000-0000-0000-000000009201'
  $$,
  '23514',
  null,
  'an 8-digit Ghana number is rejected'
);

select throws_ok(
  $$
    update public.seller_accounts
    set contact_phone = '+234241234567'
    where id = '00000000-0000-0000-0000-000000009201'
  $$,
  '23514',
  null,
  'a GH-country row with a NG-shaped calling code is rejected'
);

select is(
  (select contact_phone from public.seller_accounts where id = '00000000-0000-0000-0000-000000009201'),
  '+233241234567',
  'the row still has its original valid value after the rejected updates'
);

select * from finish();
rollback;
```

- [ ] **Step 9: Run the pgTAP suite**

Run: `pnpm db:reset && pnpm db:test`
Expected: `015_contact_phone_country_check.test.sql .. ok`; only the known pre-existing unrelated `001_core.test.sql` plan-versioning failure remains.

- [ ] **Step 10: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add src/lib/auth/onboarding.ts src/lib/auth/onboarding.test.ts supabase/migrations/202607190034_contact_phone_country_check.sql supabase/tests/database/015_contact_phone_country_check.test.sql
git commit -m "fix: validate seller phone numbers against exact per-country digit counts"
```

---

### Task 3: Fix Côte d'Ivoire guest checkout (missing from country enum + unvalidated phone)

**Files:**
- Modify: `src/lib/commerce/order.ts`
- Create: `src/lib/commerce/order.test.ts`

**Interfaces:**
- Consumes: `isValidPhoneForCountry` from `@/lib/countries/phone` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/commerce/order.test.ts
import { describe, expect, it } from "vitest";

import { parseGuestOrder } from "./order";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    shopId: "11111111-1111-4111-8111-111111111111",
    fulfillmentMethodId: "22222222-2222-4222-8222-222222222222",
    idempotencyKey: "idem-key-12345",
    paymentMethod: "cash_on_delivery",
    buyer: {
      name: "Ama Serwaa",
      email: "ama@example.com",
      phone: "0241234567",
      country: "GH",
      address: { line1: "1 Main St", area: "Osu", city: "Accra", region: "Greater Accra" },
    },
    lines: [{ productId: "33333333-3333-4333-8333-333333333333", quantity: 1 }],
    ...overrides,
  };
}

describe("parseGuestOrder", () => {
  it("accepts a Côte d'Ivoire buyer (previously rejected — CI was missing from the country enum)", () => {
    const result = parseGuestOrder(
      validInput({
        buyer: {
          name: "Kouassi Yao",
          email: "kouassi@example.com",
          phone: "0708091011",
          country: "CI",
          address: { line1: "1 Rue Principale", area: "Cocody", city: "Abidjan", region: "Abidjan" },
        },
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buyer.phone).toBe("+2250708091011");
    }
  });

  it("normalizes and accepts a valid Ghana phone number", () => {
    const result = parseGuestOrder(validInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buyer.phone).toBe("+233241234567");
    }
  });

  it("rejects a phone number with the wrong digit count for the buyer's country", () => {
    const result = parseGuestOrder(validInput({ buyer: { ...validInput().buyer, phone: "024123" } }));
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported country code", () => {
    const result = parseGuestOrder(validInput({ buyer: { ...validInput().buyer, country: "US" } }));
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/commerce/order.test.ts`
Expected: FAIL — the CI test fails because `"CI"` isn't in the current `z.enum(["GH", "NG"])`, and the wrong-digit-count test fails because `phone: z.string()` currently accepts anything.

- [ ] **Step 3: Update `src/lib/commerce/order.ts`**

Replace the file's content:

```ts
import { z } from "zod";

import { normalizePhoneNumber } from "@/lib/auth/onboarding";
import { isValidPhoneForCountry } from "@/lib/countries/phone";

const schema = z.object({
  shopId: z.uuid(),
  fulfillmentMethodId: z.uuid(),
  idempotencyKey: z.string().min(8).max(100),
  paymentMethod: z.enum(["paystack", "cash_on_delivery", "pay_on_pickup", "seller_arranged"]),
  buyer: z
    .object({
      name: z.string().trim().min(2).max(120),
      email: z.email().transform((value) => value.toLowerCase()),
      phone: z.string().trim().max(20),
      country: z.enum(["GH", "NG", "CI"]),
      address: z.object({
        line1: z.string().trim().max(200),
        area: z.string().trim().max(100),
        city: z.string().trim().max(100),
        region: z.string().trim().max(100),
      }),
      marketingConsent: z.boolean().default(false),
    })
    .refine(
      (buyer) => isValidPhoneForCountry(normalizePhoneNumber(buyer.phone, buyer.country), buyer.country),
      { message: "Enter a valid phone number for the selected country.", path: ["phone"] },
    ),
  lines: z.array(z.object({
    productId: z.uuid(),
    variantId: z.uuid().nullable().optional(),
    quantity: z.number().int().positive().max(99),
  })).min(1).max(50),
});

export function parseGuestOrder(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false as const, fieldErrors: parsed.error.flatten() };
  return {
    success: true as const,
    data: {
      ...parsed.data,
      buyer: {
        ...parsed.data.buyer,
        phone: normalizePhoneNumber(parsed.data.buyer.phone, parsed.data.buyer.country),
      },
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/commerce/order.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Confirm the checkout API route's own schema doesn't duplicate the stale enum**

Run: `grep -n "country" src/app/api/checkout/orders/route.ts`
Expected: this route delegates buyer parsing entirely to `parseGuestOrder` (no separate inline country enum) — if it DOES have its own duplicate enum missing `"CI"`, report NEEDS_CONTEXT with the exact line rather than guessing at a fix; this plan's design assumes `order.ts` is the single source of truth for this schema.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/commerce/order.ts src/lib/commerce/order.test.ts
git commit -m "fix: allow Cote d'Ivoire guest checkout and validate buyer phone per country"
```

---

### Task 4: Country-aware phone validation for restock alerts

**Files:**
- Modify: `src/app/api/restock/route.ts`
- Create: `src/app/api/restock/route.test.ts`

**Interfaces:**
- Consumes: `isValidPhoneForCountry` from `@/lib/countries/phone` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/restock/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/restock", { method: "POST", body: JSON.stringify(body) });
}

function adminMock(product: { seller_account_id: string; country: string } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: product });
  const eq3 = vi.fn().mockReturnValue({ maybeSingle });
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === "products") return { select };
    if (table === "restock_requests") return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) }) }), insert };
    return {};
  });
  return { from };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue({ ok: true });
});

describe("POST /api/restock", () => {
  it("rejects a phone number with the wrong digit count for the product's shop country", async () => {
    mocks.createAdminClient.mockReturnValue(adminMock({ seller_account_id: "seller-1", country: "GH" }));

    const response = await POST(
      request({ consent: true, phone: "+23324123456", productId: "11111111-1111-4111-8111-111111111111" }),
    );

    expect(response.status).toBe(400);
  });

  it("accepts a correctly-sized phone number for the product's shop country", async () => {
    mocks.createAdminClient.mockReturnValue(adminMock({ seller_account_id: "seller-1", country: "GH" }));

    const response = await POST(
      request({ consent: true, phone: "+233241234567", productId: "11111111-1111-4111-8111-111111111111" }),
    );

    expect(response.status).toBe(201);
  });

  it("still accepts a request with only an email (no phone to validate)", async () => {
    mocks.createAdminClient.mockReturnValue(adminMock({ seller_account_id: "seller-1", country: "GH" }));

    const response = await POST(
      request({ consent: true, email: "buyer@example.com", productId: "11111111-1111-4111-8111-111111111111" }),
    );

    expect(response.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/api/restock/route.test.ts`
Expected: FAIL — the current query doesn't select the shop's `country`, and the phone regex is generic (accepts the wrong-digit-count case, so the first test's expectation of a 400 fails).

- [ ] **Step 3: Update `src/app/api/restock/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { isValidPhoneForCountry } from "@/lib/countries/phone";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  consent: z.literal(true),
  email: z.email().optional(),
  phone: z.string().max(20).optional(),
  productId: z.uuid(),
}).refine((value) => value.email || value.phone);

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkRateLimit(`restock:${ip}`, { limit: 10, windowMs: 10 * 60_000 }).ok) return NextResponse.json({ error: "Too many requests. Please try later." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email or phone number and accept the alert." }, { status: 400 });
  const admin = createAdminClient();
  const { data: product } = await admin.from("products").select("seller_account_id,shops!inner(status,country)").eq("id", parsed.data.productId).eq("status", "active").eq("shops.status", "published").maybeSingle();
  if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  if (parsed.data.phone) {
    const shopRow = product.shops as unknown as { country?: string } | { country?: string }[] | null;
    const shopCountry = (Array.isArray(shopRow) ? shopRow[0]?.country : shopRow?.country) as "GH" | "NG" | "CI" | undefined;
    if (!shopCountry || !isValidPhoneForCountry(parsed.data.phone, shopCountry)) {
      return NextResponse.json({ error: "Enter a valid phone number for this shop's country." }, { status: 400 });
    }
  }
  let existing = null;
  if (parsed.data.email) {
    ({ data: existing } = await admin.from("restock_requests").select("id").eq("product_id", parsed.data.productId).eq("email", parsed.data.email).is("notified_at", null).maybeSingle());
  } else if (parsed.data.phone) {
    ({ data: existing } = await admin.from("restock_requests").select("id").eq("product_id", parsed.data.productId).eq("phone", parsed.data.phone).is("notified_at", null).maybeSingle());
  }
  if (!existing) {
    const { error } = await admin.from("restock_requests").insert({ consent: true, email: parsed.data.email ?? null, phone: parsed.data.phone ?? null, product_id: parsed.data.productId, seller_account_id: product.seller_account_id });
    if (error) return NextResponse.json({ error: "Unable to save request." }, { status: 500 });
  }
  return NextResponse.json({ saved: true }, { status: 201 });
}
```

Note: this changes `phone` validation from a regex-in-zod-schema to a post-parse check against the shop's country (since the country isn't known until the product/shop is looked up) — the zod schema now only bounds `phone`'s length, and the real format check happens after the `product` lookup, matching the brief's test expectations (400 only after a product/shop is found, using its country).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/app/api/restock/route.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/restock/route.ts src/app/api/restock/route.test.ts
git commit -m "fix: validate restock alert phone numbers against the shop's country"
```

---

### Task 5: Close SSRF hole in seller-configured outbound webhooks

**Files:**
- Create: `src/lib/security/url.ts`
- Create: `src/lib/security/url.test.ts`
- Modify: `src/app/(seller)/dashboard/settings/developers/actions.ts`
- Modify: `src/app/api/internal/integrations/process/route.ts`

**Interfaces:**
- Produces: `isSafeWebhookUrl(rawUrl: string): Promise<boolean>` — rejects non-http(s) schemes AND resolves the hostname via DNS to block private/loopback/link-local IP ranges (defends against both literal `http://169.254.169.254/...` and DNS-rebinding via a public hostname that resolves to a private address). Consumed by `addWebhook` (storage-time gate) and the integrations cron (fetch-time gate, defense in depth for any row written before this fix, or via any other future write path).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/security/url.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import { lookup } from "node:dns/promises";
import { isSafeWebhookUrl } from "./url";

describe("isSafeWebhookUrl", () => {
  it("rejects a javascript: URL without a DNS lookup", async () => {
    expect(await isSafeWebhookUrl("javascript:alert(1)")).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a hostname literally named localhost", async () => {
    expect(await isSafeWebhookUrl("http://localhost:3000/hook")).toBe(false);
  });

  it("rejects a public-looking hostname that resolves to a private IP (DNS rebinding)", async () => {
    vi.mocked(lookup).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(false);
  });

  it("rejects a hostname resolving to the cloud metadata address", async () => {
    vi.mocked(lookup).mockResolvedValue({ address: "169.254.169.254", family: 4 });
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(false);
  });

  it("accepts a hostname resolving to a real public IP", async () => {
    vi.mocked(lookup).mockResolvedValue({ address: "93.184.216.34", family: 4 });
    expect(await isSafeWebhookUrl("https://webhook.example.com/hook")).toBe(true);
  });

  it("rejects a hostname that fails to resolve", async () => {
    vi.mocked(lookup).mockRejectedValue(new Error("ENOTFOUND"));
    expect(await isSafeWebhookUrl("https://nonexistent.example.invalid/hook")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/security/url.test.ts`
Expected: FAIL — `Cannot find module './url'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/security/url.ts
import { lookup } from "node:dns/promises";

import { isSafeHttpUrl } from "@/lib/catalog/video";

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

function isPrivateAddress(address: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(address));
}

/**
 * True only for an http(s) URL whose hostname resolves to a real, public
 * IP address — used before storing or fetching a seller-supplied webhook
 * URL, which is otherwise a classic SSRF vector (the server itself makes
 * the request, so a URL pointing at an internal service or the cloud
 * metadata endpoint would leak infrastructure-internal data). Resolves via
 * DNS rather than checking the hostname string alone, since a public
 * hostname's DNS record can be pointed at a private address (rebinding).
 */
export async function isSafeWebhookUrl(rawUrl: string): Promise<boolean> {
  if (!isSafeHttpUrl(rawUrl)) return false;
  const url = new URL(rawUrl.trim());
  if (url.hostname === "localhost") return false;
  try {
    const { address } = await lookup(url.hostname);
    return !isPrivateAddress(address);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/security/url.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Gate `addWebhook` on the new check**

Read the current `src/app/(seller)/dashboard/settings/developers/actions.ts` to confirm the `addWebhook` function still matches:

```ts
export async function addWebhook(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role) return;
  const webhookPlan = await getSellerPlan(actor.sellerAccountId);
  if (planLimit(webhookPlan, "apiKeys") === 0) return;
  const url = String(formData.get("url"));
  try { new URL(url); } catch { return; }
  const supabase = await createClient();
  await supabase.from("outbound_webhooks").insert({ seller_account_id: actor.sellerAccountId, url, secret_encrypted: String(formData.get("secret")), event_types: formData.getAll("event").map(String) });
  revalidatePath("/dashboard/settings/developers");
}
```

Change the URL-validation line and add the import:

```ts
import { isSafeWebhookUrl } from "@/lib/security/url";
```

```ts
export async function addWebhook(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller" || actor.role) return;
  const webhookPlan = await getSellerPlan(actor.sellerAccountId);
  if (planLimit(webhookPlan, "apiKeys") === 0) return;
  const url = String(formData.get("url"));
  if (!(await isSafeWebhookUrl(url))) return;
  const supabase = await createClient();
  await supabase.from("outbound_webhooks").insert({ seller_account_id: actor.sellerAccountId, url, secret_encrypted: String(formData.get("secret")), event_types: formData.getAll("event").map(String) });
  revalidatePath("/dashboard/settings/developers");
}
```

- [ ] **Step 6: Gate the cron's outbound fetch on the same check (defense in depth)**

Read `src/app/api/internal/integrations/process/route.ts` to find the `fetch(hook.url, ...)` call. Add the same import and a guard immediately before the fetch, skipping (not crashing) any row whose stored URL no longer passes the check:

```ts
import { isSafeWebhookUrl } from "@/lib/security/url";
```

Locate the loop/call site around `fetch(hook.url, {...})` and wrap it:

```ts
if (!(await isSafeWebhookUrl(hook.url))) {
  continue; // or the equivalent skip for this loop's structure — match whatever the existing loop already does to skip one row without crashing the batch (e.g. how it likely already handles a fetch() rejection)
}
```

Read the actual file first to match its existing control-flow shape (for-loop with `continue`, `.map()`+`Promise.all`, etc.) exactly rather than guessing — if it's a `.map()`/`Promise.all` shape, use an early `return` inside that specific callback instead of `continue`.

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/security/url.ts src/lib/security/url.test.ts "src/app/(seller)/dashboard/settings/developers/actions.ts" src/app/api/internal/integrations/process/route.ts
git commit -m "fix: block SSRF via seller-configured outbound webhook URLs"
```

---

### Task 6: Prevent cumulative over-refund

**Files:**
- Modify: `src/app/api/payments/paystack/refund/route.ts`
- Create: `src/app/api/payments/paystack/refund/route.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/payments/paystack/refund/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createAdminClient: vi.fn(),
  refund: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/payments/paystack", () => ({ paystackProvider: () => ({ refund: mocks.refund }) }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/payments/paystack/refund", { method: "POST", body: JSON.stringify(body) });
}

const OPERATOR_ACTOR = { kind: "operator" as const, authenticated: true, userId: "op1", email: "op@example.com", role: "operator" as const };

function adminMock({ order, attempt, priorRefundsTotal }: { order: Record<string, unknown> | null; attempt: Record<string, unknown> | null; priorRefundsTotal: number }) {
  const from = vi.fn((table: string) => {
    if (table === "orders") {
      const maybeSingle = vi.fn().mockResolvedValue({ data: order });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      return { select: vi.fn().mockReturnValue({ eq }) };
    }
    if (table === "payment_attempts") {
      const maybeSingle = vi.fn().mockResolvedValue({ data: attempt });
      const eq2 = vi.fn().mockReturnValue({ maybeSingle });
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
      return { select: vi.fn().mockReturnValue({ eq: eq1 }) };
    }
    if (table === "refunds") {
      const eq = vi.fn().mockResolvedValue({ data: [{ amount_minor: priorRefundsTotal }].filter((r) => r.amount_minor > 0) });
      return { select: vi.fn().mockReturnValue({ eq }), insert: vi.fn().mockResolvedValue({}) };
    }
    return {};
  });
  return { from };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(OPERATOR_ACTOR);
  mocks.refund.mockResolvedValue({ providerId: "ref_1", status: "processing" });
});

describe("POST /api/payments/paystack/refund", () => {
  it("rejects a refund that would exceed the order total once prior refunds are counted", async () => {
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        order: { id: "order-1", seller_account_id: "seller-1", total_minor: 10_000, payment_status: "paid" },
        attempt: { id: "attempt-1", reference: "ref-abc" },
        priorRefundsTotal: 7_000,
      }),
    );

    const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111", amountMinor: 5_000 }));

    expect(response.status).toBe(400);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("allows a refund that fits within the remaining unrefunded balance", async () => {
    mocks.createAdminClient.mockReturnValue(
      adminMock({
        order: { id: "order-1", seller_account_id: "seller-1", total_minor: 10_000, payment_status: "paid" },
        attempt: { id: "attempt-1", reference: "ref-abc" },
        priorRefundsTotal: 7_000,
      }),
    );

    const response = await POST(request({ orderId: "11111111-1111-4111-8111-111111111111", amountMinor: 3_000 }));

    expect(response.status).toBe(202);
    expect(mocks.refund).toHaveBeenCalledWith({ reference: "ref-abc", amountMinor: 3_000 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/api/payments/paystack/refund/route.test.ts`
Expected: FAIL — the current route only checks `amount > order.total_minor`, ignoring prior refunds, so the first test's expected 400 doesn't happen.

- [ ] **Step 3: Update `src/app/api/payments/paystack/refund/route.ts`**

Replace:

```ts
  const amount = parsed.data.amountMinor ?? order.total_minor;
  if (amount > order.total_minor) return NextResponse.json({ error: "Amount exceeds paid balance." }, { status: 400 });
```

with:

```ts
  const { data: priorRefunds } = await admin.from("refunds").select("amount_minor").eq("order_id", order.id);
  const alreadyRefundedMinor = (priorRefunds ?? []).reduce((sum, row) => sum + row.amount_minor, 0);
  const remainingMinor = order.total_minor - alreadyRefundedMinor;
  const amount = parsed.data.amountMinor ?? remainingMinor;
  if (amount > remainingMinor) return NextResponse.json({ error: "Amount exceeds the unrefunded balance." }, { status: 400 });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/app/api/payments/paystack/refund/route.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/payments/paystack/refund/route.ts src/app/api/payments/paystack/refund/route.test.ts
git commit -m "fix: prevent cumulative refunds from exceeding the order's paid total"
```

---

### Task 7: Rate limit checkout quote and analytics event endpoints

**Files:**
- Modify: `src/app/api/checkout/quote/route.ts`
- Modify: `src/app/api/analytics/events/route.ts`
- Create: `src/app/api/checkout/quote/route.test.ts`
- Create: `src/app/api/analytics/events/route.test.ts`

**Interfaces:**
- Consumes: `checkRateLimit` from `@/lib/rate-limit` (existing).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/checkout/quote/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn(), createAdminClient: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/checkout/quote", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.5" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue({ ok: true });
});

describe("POST /api/checkout/quote", () => {
  it("checks the rate limit before touching the database", async () => {
    mocks.checkRateLimit.mockReturnValue({ ok: false, retryAfterMs: 5_000 });

    const response = await POST(
      request({
        shopId: "11111111-1111-4111-8111-111111111111",
        fulfillmentMethodId: "22222222-2222-4222-8222-222222222222",
        lines: [{ productId: "33333333-3333-4333-8333-333333333333", quantity: 1 }],
      }),
    );

    expect(response.status).toBe(429);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("keys the rate limit by client IP", async () => {
    await POST(
      request({
        shopId: "11111111-1111-4111-8111-111111111111",
        fulfillmentMethodId: "22222222-2222-4222-8222-222222222222",
        lines: [{ productId: "33333333-3333-4333-8333-333333333333", quantity: 1 }],
      }),
    ).catch(() => {});

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.stringContaining("203.0.113.5"), expect.any(Object));
  });
});
```

```ts
// src/app/api/analytics/events/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn(), createAdminClient: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/analytics/events", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue({ ok: true });
});

describe("POST /api/analytics/events", () => {
  it("rejects when the rate limit is exceeded, before any database write", async () => {
    mocks.checkRateLimit.mockReturnValue({ ok: false, retryAfterMs: 1_000 });

    const response = await POST(
      request({
        id: "11111111-1111-4111-8111-111111111111",
        shopId: "22222222-2222-4222-8222-222222222222",
        sessionId: "33333333-3333-4333-8333-333333333333",
        eventType: "product_view",
      }),
    );

    expect(response.status).toBe(429);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
```

(Check `analyticsEventTypes` includes `"product_view"` — if the real enum doesn't have this exact value, use the first value it actually exports instead, found via `grep -n "analyticsEventTypes" src/lib/analytics/events.ts`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/api/checkout/quote/route.test.ts src/app/api/analytics/events/route.test.ts`
Expected: FAIL — neither route currently calls `checkRateLimit` at all, so both 429 expectations fail (routes proceed straight to the DB mocks, which return `undefined`-shaped data and likely produce a 409/500 instead of 429).

- [ ] **Step 3: Update `src/app/api/checkout/quote/route.ts`**

Add the import and a rate-limit check as the first lines of `POST`, matching the pattern from `src/app/api/restock/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { deriveAvailability } from "@/lib/catalog/inventory";
import { calculateQuote } from "@/lib/commerce/quote";
import { calculateDiscount } from "@/lib/promotions/discounts";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  shopId: z.uuid(),
  fulfillmentMethodId: z.uuid(),
  lines: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().positive().max(99) })).min(1),
  promotionCode: z.string().max(50).optional(),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkRateLimit(`checkout-quote:${ip}`, { limit: 30, windowMs: 60_000 }).ok) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid quote request." }, { status: 400 });
  // ... rest of the function body unchanged
```

Keep every line after the existing `if (!parsed.success) ...` unchanged — only the import and the new rate-limit block at the top of `POST` are added.

- [ ] **Step 4: Update `src/app/api/analytics/events/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { analyticsEventTypes } from "@/lib/analytics/events";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  id: z.uuid(), shopId: z.uuid(), sessionId: z.uuid(),
  eventType: z.enum(analyticsEventTypes), productId: z.uuid().nullable().optional(),
  source: z.string().max(100).nullable().optional(), campaign: z.string().max(100).nullable().optional(),
  country: z.enum(["GH","NG","CI"]).nullable().optional(),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkRateLimit(`analytics-events:${ip}`, { limit: 60, windowMs: 60_000 }).ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  // ... rest of the function body unchanged
```

Keep every line after the existing `if (!parsed.success) ...` unchanged — only the import and the new rate-limit block at the top of `POST` are added. Note the higher limit (60/min vs. quote's 30/min) since analytics events fire more frequently during normal browsing (page views, add-to-cart) than checkout quote requests.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/app/api/checkout/quote/route.test.ts src/app/api/analytics/events/route.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 6: Run the existing test suites for both files to confirm no regression**

Run: `pnpm vitest run src/app/api/checkout/ src/app/api/analytics/`
Expected: all pre-existing tests for sibling routes in these directories still pass (this task only adds new files/lines, doesn't touch shared helpers).

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/checkout/quote/route.ts src/app/api/analytics/events/route.ts src/app/api/checkout/quote/route.test.ts src/app/api/analytics/events/route.test.ts
git commit -m "feat: rate limit checkout quote and analytics event endpoints"
```

---

### Task 8: Timing-safe secret comparison for webhook/internal-job auth

**Files:**
- Modify: `src/lib/internal-jobs/auth.ts`
- Modify: `src/app/api/couriers/webhook/[provider]/route.ts`
- Create: `src/lib/internal-jobs/auth.test.ts`

**Interfaces:**
- Produces: nothing consumed by later tasks. `isInternalJobRequest`'s exported signature is unchanged (still `(request: Request) => boolean`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/internal-jobs/auth.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isInternalJobRequest } from "./auth";

const originalEnv = { ...process.env };

function request(authHeader: string | null) {
  const headers = new Headers();
  if (authHeader !== null) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/internal/x", { headers });
}

describe("isInternalJobRequest", () => {
  beforeEach(() => {
    process.env.INTERNAL_JOB_SECRET = "correct-secret-value";
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("accepts the correct bearer secret", () => {
    expect(isInternalJobRequest(request("Bearer correct-secret-value"))).toBe(true);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(isInternalJobRequest(request("Bearer wrong-secret-value"))).toBe(false);
  });

  it("rejects a wrong secret of a different length without throwing", () => {
    expect(isInternalJobRequest(request("Bearer short"))).toBe(false);
  });

  it("rejects a missing authorization header", () => {
    expect(isInternalJobRequest(request(null))).toBe(false);
  });

  it("rejects when no secret is configured at all", () => {
    delete process.env.INTERNAL_JOB_SECRET;
    expect(isInternalJobRequest(request("Bearer anything"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/internal-jobs/auth.test.ts`
Expected: PASS already, most likely — the current `===` comparison is functionally correct for these behavioral tests (timing-safety isn't observable via a unit test's pass/fail). This is expected: the fix in this task is a defense-in-depth change (removing a timing side-channel), not a behavior fix, so these tests establish a safety net BEFORE the refactor, not a RED step proving a bug. Confirm they pass with the current code before proceeding to Step 3.

- [ ] **Step 3: Update `src/lib/internal-jobs/auth.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import "server-only";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function isInternalJobRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return false;
  const secrets = [process.env.INTERNAL_JOB_SECRET, process.env.CRON_SECRET].filter((secret): secret is string => Boolean(secret));
  return secrets.length > 0 && secrets.some((secret) => safeEqual(authorization, `Bearer ${secret}`));
}
```

- [ ] **Step 4: Run tests to verify they still pass**

Run: `pnpm vitest run src/lib/internal-jobs/auth.test.ts`
Expected: PASS — all 5 tests green (behavior identical, timing side-channel closed).

- [ ] **Step 5: Apply the same fix to the courier webhook route**

Read `src/app/api/couriers/webhook/[provider]/route.ts` to confirm the current secret check still matches:

```ts
const secret=process.env[`COURIER_${provider.toUpperCase()}_WEBHOOK_SECRET`];if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});
```

Replace with (add `timingSafeEqual` to the existing `node:crypto` import at the top of the file, which already imports `createHash` from the same module):

```ts
const secret=process.env[`COURIER_${provider.toUpperCase()}_WEBHOOK_SECRET`];const authHeader=request.headers.get("authorization");if(!secret||!authHeader){return NextResponse.json({error:"Unauthorized"},{status:401});}const expected=Buffer.from(`Bearer ${secret}`);const received=Buffer.from(authHeader);if(expected.length!==received.length||!timingSafeEqual(expected,received)){return NextResponse.json({error:"Unauthorized"},{status:401});}
```

Update the file's first line import from `import {createHash} from "node:crypto";` to `import {createHash,timingSafeEqual} from "node:crypto";`.

Match the file's existing minified single-line style (no reformatting to multi-line) since that's this file's established convention — do not reformat unrelated parts of the file.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/internal-jobs/auth.ts src/lib/internal-jobs/auth.test.ts "src/app/api/couriers/webhook/[provider]/route.ts"
git commit -m "fix: use timing-safe comparison for internal-job and courier-webhook secrets"
```

---

### Task 9: Verify broadcast segment ownership before use

**Files:**
- Modify: `src/app/(seller)/dashboard/growth/broadcasts/actions.ts`
- Create: `src/app/(seller)/dashboard/growth/broadcasts/actions.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/(seller)/dashboard/growth/broadcasts/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveServerActor: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  getSellerPlan: vi.fn(),
  withinPlanLimit: vi.fn(),
}));

vi.mock("@/lib/auth/actor", () => ({ resolveServerActor: mocks.resolveServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/billing/resolve", () => ({ getSellerPlan: mocks.getSellerPlan, withinPlanLimit: mocks.withinPlanLimit }));

import { createBroadcast } from "./actions";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

const SELLER_ACTOR = {
  kind: "seller" as const, authenticated: true, userId: "u1", email: "seller@example.com",
  sellerAccountId: "seller-1", country: "GH" as const, status: "active" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveServerActor.mockResolvedValue(SELLER_ACTOR);
  mocks.getSellerPlan.mockResolvedValue({});
  mocks.withinPlanLimit.mockReturnValue(true);
});

describe("createBroadcast", () => {
  it("does not insert a broadcast when the referenced segment does not belong to the seller", async () => {
    const segmentMaybeSingle = vi.fn().mockResolvedValue({ data: null });
    const segmentEq2 = vi.fn().mockReturnValue({ maybeSingle: segmentMaybeSingle });
    const segmentEq1 = vi.fn().mockReturnValue({ eq: segmentEq2 });
    const segmentSelect = vi.fn().mockReturnValue({ eq: segmentEq1 });
    const insert = vi.fn().mockResolvedValue({});
    const usageCount = vi.fn().mockResolvedValue({ count: 0 });
    const from = vi.fn((table: string) => {
      if (table === "customer_segments") return { select: segmentSelect };
      if (table === "marketing_broadcasts") return { select: () => ({ eq: () => ({ gte: usageCount }) }), insert };
      return {};
    });
    mocks.createClient.mockResolvedValue({ from });

    await createBroadcast(formData({ channel: "email", body: "Hello", segmentId: "not-mine-segment" }));

    expect(insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run "src/app/(seller)/dashboard/growth/broadcasts/actions.test.ts"`
Expected: FAIL — the current `createBroadcast` never queries `customer_segments` at all, so `insert` IS called even for a segment ID belonging to another seller.

- [ ] **Step 3: Update `createBroadcast` in `src/app/(seller)/dashboard/growth/broadcasts/actions.ts`**

Replace:

```ts
export async function createBroadcast(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return;
  const channel = String(formData.get("channel"));
  const body = String(formData.get("body")).trim();
  const segmentId = String(formData.get("segmentId") ?? "");
  if (!["email", "whatsapp", "push"].includes(channel) || !body) return;
  const supabase = await createClient();
  const [plan, used] = await Promise.all([
    getSellerPlan(actor.sellerAccountId),
    monthlyBroadcastUsage(supabase, actor.sellerAccountId),
  ]);
  if (!withinPlanLimit(plan, "broadcastsPerMonth", used)) return;
  await supabase.from("marketing_broadcasts").insert({
    body,
    channel,
    segment_id: segmentId || null,
    seller_account_id: actor.sellerAccountId,
    state: "draft",
    subject: String(formData.get("subject")).trim() || null,
  });
  revalidatePath("/dashboard/growth/broadcasts");
}
```

with:

```ts
export async function createBroadcast(formData: FormData) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return;
  const channel = String(formData.get("channel"));
  const body = String(formData.get("body")).trim();
  const segmentId = String(formData.get("segmentId") ?? "");
  if (!["email", "whatsapp", "push"].includes(channel) || !body) return;
  const supabase = await createClient();
  if (segmentId) {
    const { data: segment } = await supabase
      .from("customer_segments")
      .select("id")
      .eq("id", segmentId)
      .eq("seller_account_id", actor.sellerAccountId)
      .maybeSingle();
    if (!segment) return;
  }
  const [plan, used] = await Promise.all([
    getSellerPlan(actor.sellerAccountId),
    monthlyBroadcastUsage(supabase, actor.sellerAccountId),
  ]);
  if (!withinPlanLimit(plan, "broadcastsPerMonth", used)) return;
  await supabase.from("marketing_broadcasts").insert({
    body,
    channel,
    segment_id: segmentId || null,
    seller_account_id: actor.sellerAccountId,
    state: "draft",
    subject: String(formData.get("subject")).trim() || null,
  });
  revalidatePath("/dashboard/growth/broadcasts");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run "src/app/(seller)/dashboard/growth/broadcasts/actions.test.ts"`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(seller)/dashboard/growth/broadcasts/actions.ts" "src/app/(seller)/dashboard/growth/broadcasts/actions.test.ts"
git commit -m "fix: verify broadcast segment ownership before creating a broadcast"
```

---

### Task 10: Form-validation hardening batch

**Files:**
- Modify: `src/app/(seller)/dashboard/products/actions.ts`
- Modify: `src/lib/catalog/schema.ts`
- Modify: `src/lib/catalog/schema.test.ts` (create if it doesn't exist)
- Modify: `src/app/(seller)/dashboard/settings/team/actions.ts`
- Modify: `src/app/admin/actions.ts`
- Modify: `src/app/admin/sellers/page.tsx`
- Modify: `src/app/api/admin/exports/products/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Check for an existing `src/lib/catalog/schema.test.ts`**

Run: `ls src/lib/catalog/schema.test.ts 2>&1`
If it exists, read it first and append new tests to it in Step 2 rather than replacing the file. If it doesn't exist, Step 2 creates it fresh.

- [ ] **Step 2: Write/append failing tests for price and stock length bounds**

```ts
// src/lib/catalog/schema.test.ts (append if the file already exists, matching its existing import/describe structure; create fresh with this content otherwise)
import { describe, expect, it } from "vitest";

import { parseProductInput } from "./schema";

describe("parseProductInput price/stock bounds", () => {
  it("rejects a price string long enough to lose precision when converted to a number", () => {
    const result = parseProductInput({
      name: "Test Product",
      price: "9".repeat(20),
      currency: "GHS",
      inventoryPolicy: "continue_selling",
      status: "draft",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a normal price", () => {
    const result = parseProductInput({
      name: "Test Product",
      price: "15000",
      currency: "GHS",
      inventoryPolicy: "continue_selling",
      status: "draft",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a stock quantity string long enough to lose precision", () => {
    const result = parseProductInput({
      name: "Test Product",
      price: "15000",
      currency: "GHS",
      inventoryPolicy: "track",
      stockQuantity: "9".repeat(20),
      status: "draft",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/catalog/schema.test.ts`
Expected: FAIL — the current `price`/`stockQuantity` regexes (`/^\d+$/`) have no length cap, so a 20-digit string currently passes.

- [ ] **Step 4: Update `src/lib/catalog/schema.ts`**

Change:

```ts
    price: z.string().regex(/^\d+$/, "Enter a whole minor-unit amount."),
```

to:

```ts
    price: z.string().regex(/^\d{1,12}$/, "Enter a whole minor-unit amount."),
```

Change the `superRefine` block's stock check from:

```ts
    if (
      value.inventoryPolicy === "track" &&
      !/^\d+$/.test(value.stockQuantity)
    ) {
```

to:

```ts
    if (
      value.inventoryPolicy === "track" &&
      !/^\d{1,12}$/.test(value.stockQuantity)
    ) {
```

(12 digits covers any realistic price/stock value in minor units while safely fitting in `Number`'s exact-integer range, `Number.MAX_SAFE_INTEGER` has 16 digits.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/catalog/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the missing shop-currency check to `updateProductAction`**

Read `src/app/(seller)/dashboard/products/actions.ts` and find `updateProductAction` and `createProductAction`. Confirm `createProductAction` has a check shaped like:

```ts
if (shop.currency !== parsed.data.currency) { /* ...fails with an error state... */ }
```

Find the equivalent point in `updateProductAction` (after it fetches the product/shop and before the update query) and add the same currency check, matching `createProductAction`'s exact error-message/return-shape convention in this file (read the surrounding code to match the file's established error-return pattern for this function — e.g. if it returns an error state object like `{ status: "error", message: "..." }`, mirror that exact shape rather than inventing a new one).

- [ ] **Step 7: Add a regression test for the currency check**

Add a test to `src/app/(seller)/dashboard/products/actions.test.ts` (append to the existing file, matching its established mocking conventions) confirming `updateProductAction` rejects a currency that doesn't match the shop's currency, mirroring whatever existing test (if any) already covers this for `createProductAction` — use that test as your template.

- [ ] **Step 8: Switch team invite email validation to `z.email()`**

In `src/app/(seller)/dashboard/settings/team/actions.ts`, the current line:

```ts
if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!["manager","catalog","fulfillment","support","analyst"].includes(role))redirect("/dashboard/settings/team?error=Check+the+email+and+role");
```

Add `import { z } from "zod";` at the top of the file, and replace the regex test with:

```ts
if(!z.email().safeParse(email).success||!["manager","catalog","fulfillment","support","analyst"].includes(role))redirect("/dashboard/settings/team?error=Check+the+email+and+role");
```

Match the file's existing minified single-line style — do not reformat surrounding code.

- [ ] **Step 9: Add an existence check to `applyRiskAction`**

In `src/app/admin/actions.ts`, find `applyRiskAction` (currently starts with `const sellerId = String(formData.get("sellerId"));` and proceeds straight to inserting/updating without confirming the seller exists). Read the file's sibling functions `reviewPayoutAction`/`approveVerificationAction` to find their exact existence-check pattern (a `.select(...).maybeSingle()` before acting), and add the equivalent check to `applyRiskAction`: fetch the seller account by `sellerId` first, and return early (matching this function's existing early-return convention — it already does `if (...) return;` for other validation failures) if it doesn't exist.

- [ ] **Step 10: Bound and sanitize the admin search filter inputs**

In `src/app/admin/sellers/page.tsx`, change:

```ts
  if (q?.trim()) {
    query = query.or(`contact_name.ilike.%${q.trim()}%,contact_email.ilike.%${q.trim()}%`);
  }
```

to:

```ts
  if (q?.trim()) {
    const safeQuery = q.trim().slice(0, 100).replace(/[%,()]/g, "");
    query = query.or(`contact_name.ilike.%${safeQuery}%,contact_email.ilike.%${safeQuery}%`);
  }
```

In `src/app/api/admin/exports/products/route.ts`, change:

```ts
  const q = url.searchParams.get("q")?.trim();
  if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`);
```

to:

```ts
  const q = url.searchParams.get("q")?.trim();
  if (q) {
    const safeQuery = q.slice(0, 100).replace(/[%,()]/g, "");
    query = query.or(`name.ilike.%${safeQuery}%,sku.ilike.%${safeQuery}%`);
  }
```

- [ ] **Step 11: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 12: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass, including every new/modified test in this task.

- [ ] **Step 13: Commit**

```bash
git add src/lib/catalog/schema.ts src/lib/catalog/schema.test.ts "src/app/(seller)/dashboard/products/actions.ts" "src/app/(seller)/dashboard/products/actions.test.ts" "src/app/(seller)/dashboard/settings/team/actions.ts" src/app/admin/actions.ts src/app/admin/sellers/page.tsx src/app/api/admin/exports/products/route.ts
git commit -m "fix: bound price/stock digit length, verify updateProductAction currency, harden admin search filters and risk-action existence check"
```

---

### Task 11: Full verification pass

**Files:** none — this task runs checks across everything built in Tasks 1–10.

- [ ] **Step 1: Run the full automated test suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: typecheck clean, lint clean, all vitest suites pass.

- [ ] **Step 2: Run the pgTAP suite**

Run: `pnpm db:reset && pnpm db:test`
Expected: `015_contact_phone_country_check.test.sql .. ok`; no new failures beyond the known pre-existing, unrelated `001_core.test.sql` plan-versioning issue.

- [ ] **Step 3: Re-run `pnpm audit --prod`**

Run: `pnpm audit --prod`
Expected: no new HIGH/CRITICAL findings introduced by this branch (this task added no new dependencies).

- [ ] **Step 4: Manual spot-check on local dev**

Run: `pnpm dev:local`.
1. Attempt guest checkout on a Côte d'Ivoire shop (or simulate via the checkout API directly) — confirm it no longer fails with a generic validation error.
2. Attempt seller onboarding with a Ghana phone number missing digits (e.g. `024123`) — confirm a specific "Enter a valid phone number" error, not a silent accept.
3. Attempt to add an outbound webhook (Settings → Developers) pointing at `http://localhost:3000/` or `http://169.254.169.254/` — confirm it's silently rejected (the action returns without inserting).
4. Confirm the courier tracking-URL fix and product-video fix from earlier this session are still working (spot-check, no new test needed — already covered by their own task-level tests).

- [ ] **Step 5: Report results**

No commit for this task — it's verification only. If any check fails, return to the relevant task above and fix before considering the plan complete.
