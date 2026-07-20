# Pending-State Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every dashboard/admin server-action button visible pending feedback (disabled + label swap) so users know a click registered while it's in flight.

**Architecture:** Two new thin `useFormStatus`-based client components — `SubmitButton` (single-button forms) and `FormActionButton` (multi-button forms, matched by `name`/`value` or by `formAction` reference) — promoted from the existing login-page-only precedent. Retrofit every plain `<button type="submit">` in the seller dashboard and admin console to use them. No server action signatures change; this is purely a client-rendering concern.

**Tech Stack:** Next.js 16 App Router, React 19 (`useFormStatus`), existing Tailwind + legacy `.btn-*` CSS classes (both already define `:disabled` styling in `globals.css`), Vitest + Testing Library.

## Global Constraints

- Every server action signature stays exactly as-is — this plan only changes what renders the submit button, never the action functions themselves.
- Two parallel button-styling systems exist in this codebase and this plan does not unify them: the legacy `.btn-primary`/`.btn-secondary`/`.btn-danger` CSS classes (used by most `dashboard/settings/**`, `dashboard/growth/**`, and `products/[productId]/page.tsx`) and the newer bespoke-Tailwind `sd-` redesign system (used by `dashboard/share/page.tsx`, `dashboard/products/page.tsx`, `product-media-manager.tsx`, and all of `admin/**`). `SubmitButton`/`FormActionButton` accept an arbitrary `className` string and apply zero opinion about which system a caller uses — this is why the existing login-page `SubmitButton` already works this way, and this plan keeps that.
- The legacy `.btn-primary`/`.btn-secondary`/`.btn-danger` classes already define `:disabled { opacity: .45; cursor: not-allowed; }` in `src/app/globals.css` — retrofitted legacy-styled buttons get dimmed styling for free from `disabled={pending}` alone; only the label swap needs component logic.
- Buyer-facing storefront/checkout (`src/app/(storefront)/**`) is explicitly OUT of scope — it doesn't use server actions at all, and its own client-side pending-state handling (`checkout-form.tsx`, `purchase-actions.tsx`, `restock-form.tsx`) is already correct. Do not touch it.
- Do not touch the 5 dashboard components that already implement pending state correctly: `key-form.tsx`, `payout-request-form.tsx`, `product-form.tsx`, `shipping-booking-form.tsx`, `image-uploader.tsx`, `logo-uploader.tsx`.
- Every retrofit is a pure UI change to an existing, already-rendering `<form>` — no new tests are required proving the underlying server actions still work (they're unchanged and already covered by their own existing tests). New tests are required only for the two new shared components (Task 1).

---

### Task 1: Shared pending-state button components

**Files:**
- Create: `src/components/ui/submit-button.tsx`
- Modify: `src/components/ui/ui-kit.test.tsx` (append new `describe` blocks — this file already aggregates small `src/components/ui/` component tests, e.g. `Badge`, `Button`, `MetricTile`)

**Interfaces:**
- Produces: `SubmitButton({ children, pendingLabel?, className?, disabled? })` — for forms with exactly one submit button. Renders `<button type="submit">`, disabled and showing `pendingLabel` (or `children` if `pendingLabel` omitted) while its enclosing `<form>` is submitting.
- Produces: `FormActionButton(props)` — for forms with multiple submit buttons where only the clicked one should show its own pending label, while every button in the form is disabled during submission. Two mutually exclusive matching modes via a discriminated union: `{ name, value }` (matches when `useFormStatus().data` has that `name`/`value` pair — for buttons that share the form's own `action` and are told apart by their own `name`/`value`) or `{ formAction }` (matches when `useFormStatus().action === formAction` — for buttons that each override the form's action via their own `formAction` prop).
- Consumed by Tasks 2–9.

- [ ] **Step 1: Write the failing tests**

```tsx
// append to src/components/ui/ui-kit.test.tsx

// Add to the top-of-file imports:
// import { FormActionButton, SubmitButton } from "./submit-button";
// vi.mock("react-dom", async (importOriginal) => {
//   const actual = await importOriginal<typeof import("react-dom")>();
//   return { ...actual, useFormStatus: vi.fn() };
// });
// import { useFormStatus } from "react-dom";
//
// These three additions must go ABOVE the existing describe blocks in the file
// (vi.mock calls are hoisted by Vitest regardless of position, but keep the
// mock and its import together at the top for readability, matching how
// src/lib/security/url.test.ts in this codebase mocks node:dns/promises).

describe("SubmitButton", () => {
  it("renders children, enabled, when not pending", () => {
    vi.mocked(useFormStatus).mockReturnValue({ pending: false, data: null, method: null, action: null });
    render(<SubmitButton className="btn-primary" pendingLabel="Saving…">Save</SubmitButton>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).not.toBeDisabled();
    expect(button.className).toContain("btn-primary");
  });

  it("swaps to the pending label and disables while pending", () => {
    vi.mocked(useFormStatus).mockReturnValue({ pending: true, data: null, method: null, action: null });
    render(<SubmitButton pendingLabel="Saving…">Save</SubmitButton>);
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
  });

  it("falls back to children as the pending label when none is given", () => {
    vi.mocked(useFormStatus).mockReturnValue({ pending: true, data: null, method: null, action: null });
    render(<SubmitButton>Save</SubmitButton>);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("FormActionButton", () => {
  it("shows the pending label only on the button whose name/value was submitted, disables both", () => {
    const data = new FormData();
    data.set("decision", "approved");
    vi.mocked(useFormStatus).mockReturnValue({ pending: true, data, method: "POST", action: null });
    render(
      <>
        <FormActionButton name="decision" value="approved" pendingLabel="Approving…">Approve</FormActionButton>
        <FormActionButton name="decision" value="rejected" pendingLabel="Rejecting…">Reject</FormActionButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled();
    const rejectButton = screen.getByRole("button", { name: "Reject" });
    expect(rejectButton).toBeDisabled();
  });

  it("shows plain children on both buttons when not pending", () => {
    vi.mocked(useFormStatus).mockReturnValue({ pending: false, data: null, method: null, action: null });
    render(
      <>
        <FormActionButton name="decision" value="approved">Approve</FormActionButton>
        <FormActionButton name="decision" value="rejected">Reject</FormActionButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).not.toBeDisabled();
  });

  it("matches by formAction reference when name/value are not provided", () => {
    const saveAction = vi.fn();
    const hideAction = vi.fn();
    vi.mocked(useFormStatus).mockReturnValue({ pending: true, data: new FormData(), method: "POST", action: saveAction });
    render(
      <>
        <FormActionButton formAction={saveAction} pendingLabel="Saving…">Save</FormActionButton>
        <FormActionButton formAction={hideAction} pendingLabel="Hiding…">Hide</FormActionButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/ui/ui-kit.test.tsx`
Expected: FAIL — `Cannot find module './submit-button'`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/ui/submit-button.tsx
"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * Submit button for a form with exactly one action. Shows `pendingLabel`
 * (or `children` if omitted) and disables itself while the enclosing
 * <form>'s action is in flight.
 */
export function SubmitButton({ children, pendingLabel, className, disabled }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button aria-disabled={pending || disabled} className={className} disabled={pending || disabled} type="submit">
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}

type FormActionButtonProps = {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
} & (
  | { name: string; value: string; formAction?: undefined }
  | { formAction: (formData: FormData) => void | Promise<void>; name?: undefined; value?: undefined }
);

/**
 * Submit button for a form with MORE than one submit button, where only
 * the button that was actually clicked should show its own pending label.
 * `useFormStatus().pending` is true for every button in the form during
 * submission (pending state lives on the form, not the button) — so this
 * disables all of them (preventing double-submits) but only swaps the
 * label on the one that matches, via either:
 *  - `name`/`value`: buttons that share the form's own `action` and are
 *    told apart by their own name/value pair (inspects the submitted
 *    FormData, which useFormStatus() exposes as `.data`).
 *  - `formAction`: buttons that each override the form's action with
 *    their own `formAction` prop (compared by reference against
 *    useFormStatus().action, which holds the action of the in-flight
 *    submission).
 */
export function FormActionButton(props: FormActionButtonProps) {
  const { children, pendingLabel, className } = props;
  const status = useFormStatus();
  const isThisPending =
    status.pending &&
    ("formAction" in props && props.formAction !== undefined
      ? status.action === props.formAction
      : status.data?.get(props.name!) === props.value);
  return (
    <button
      aria-disabled={status.pending}
      className={className}
      disabled={status.pending}
      formAction={"formAction" in props ? props.formAction : undefined}
      name={"name" in props ? props.name : undefined}
      type="submit"
      value={"value" in props ? props.value : undefined}
    >
      {isThisPending ? (pendingLabel ?? children) : children}
    </button>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/ui/ui-kit.test.tsx`
Expected: PASS — all tests green, including the pre-existing `Badge`/`Button`/`MetricTile`/etc. tests already in this file.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/submit-button.tsx src/components/ui/ui-kit.test.tsx
git commit -m "feat: add SubmitButton and FormActionButton for form pending-state UI"
```

---

### Task 2: Retrofit dashboard/settings simple forms (branding, discovery, fulfillment, notifications, team, developers)

**Files:**
- Modify: `src/app/(seller)/dashboard/settings/branding/page.tsx`
- Modify: `src/app/(seller)/dashboard/settings/discovery/page.tsx`
- Modify: `src/app/(seller)/dashboard/settings/fulfillment/page.tsx`
- Modify: `src/app/(seller)/dashboard/settings/notifications/page.tsx`
- Modify: `src/app/(seller)/dashboard/settings/team/page.tsx`
- Modify: `src/app/(seller)/dashboard/settings/developers/page.tsx`

**Interfaces:**
- Consumes: `SubmitButton` from `@/components/ui/submit-button` (Task 1).

Every button below is a single-button-per-form swap: replace the plain `<button>` with `<SubmitButton>` carrying the same `className`, and add the import. No other JSX changes.

- [ ] **Step 1: `settings/branding/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Save theme</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Saving theme…">Save theme</SubmitButton>
```

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Add domain</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Adding…">Add domain</SubmitButton>
```

Replace:
```tsx
              <button className="btn-secondary text-sm" type="submit">Check DNS</button>
```
with:
```tsx
              <SubmitButton className="btn-secondary text-sm" pendingLabel="Checking…">Check DNS</SubmitButton>
```

- [ ] **Step 2: `settings/discovery/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Save discovery settings</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Saving…">Save discovery settings</SubmitButton>
```

- [ ] **Step 3: `settings/fulfillment/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Add method</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Adding…">Add method</SubmitButton>
```

Replace:
```tsx
              <button className="btn-secondary" type="submit">Save</button>
```
with:
```tsx
              <SubmitButton className="btn-secondary" pendingLabel="Saving…">Save</SubmitButton>
```

Replace:
```tsx
              <button className={method.active ? "btn-danger" : "btn-secondary"} type="submit">
                {method.active ? "Deactivate" : "Activate"}
              </button>
```
with:
```tsx
              <SubmitButton
                className={method.active ? "btn-danger" : "btn-secondary"}
                pendingLabel={method.active ? "Deactivating…" : "Activating…"}
              >
                {method.active ? "Deactivate" : "Activate"}
              </SubmitButton>
```

- [ ] **Step 4: `settings/notifications/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Save preferences</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Saving…">Save preferences</SubmitButton>
```

- [ ] **Step 5: `settings/team/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
          <button className="btn-primary w-full" type="submit">Create invitation</button>
```
with:
```tsx
          <SubmitButton className="btn-primary w-full" pendingLabel="Sending invitation…">Create invitation</SubmitButton>
```

Replace:
```tsx
              <button className="btn-danger text-sm" type="submit">Revoke access</button>
```
with:
```tsx
              <SubmitButton className="btn-danger text-sm" pendingLabel="Revoking…">Revoke access</SubmitButton>
```

- [ ] **Step 6: `settings/developers/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Add webhook</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Adding…">Add webhook</SubmitButton>
```

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Create rule</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Creating…">Create rule</SubmitButton>
```

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(seller)/dashboard/settings/branding/page.tsx" "src/app/(seller)/dashboard/settings/discovery/page.tsx" "src/app/(seller)/dashboard/settings/fulfillment/page.tsx" "src/app/(seller)/dashboard/settings/notifications/page.tsx" "src/app/(seller)/dashboard/settings/team/page.tsx" "src/app/(seller)/dashboard/settings/developers/page.tsx"
git commit -m "feat: add pending-state feedback to seller settings forms"
```

---

### Task 3: Retrofit dashboard/growth + share + product-media-manager simple forms

**Files:**
- Modify: `src/app/(seller)/dashboard/growth/promotions/page.tsx`
- Modify: `src/app/(seller)/dashboard/growth/segments/page.tsx`
- Modify: `src/app/(seller)/dashboard/growth/campaigns/page.tsx`
- Modify: `src/app/(seller)/dashboard/growth/broadcasts/page.tsx`
- Modify: `src/app/(seller)/dashboard/share/page.tsx`
- Modify: `src/components/seller/product-media-manager.tsx`

**Interfaces:**
- Consumes: `SubmitButton` from `@/components/ui/submit-button` (Task 1).

- [ ] **Step 1: `growth/promotions/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Create promotion</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Creating…">Create promotion</SubmitButton>
```

- [ ] **Step 2: `growth/segments/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Create segment</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Creating…">Create segment</SubmitButton>
```

- [ ] **Step 3: `growth/campaigns/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Create tracked link</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Creating…">Create tracked link</SubmitButton>
```

- [ ] **Step 4: `growth/broadcasts/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Save draft</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Saving…">Save draft</SubmitButton>
```

Replace:
```tsx
                <button className="btn-primary" type="submit">Schedule / send now</button>
```
with:
```tsx
                <SubmitButton className="btn-primary" pendingLabel="Scheduling…">Schedule / send now</SubmitButton>
```

Replace (both occurrences — the two `cancelBroadcast` forms, one under the `draft` branch and one under the `scheduled` branch):
```tsx
              <form action={cancelBroadcast}><input name="id" type="hidden" value={item.id} /><button className="btn-secondary" type="submit">Cancel</button></form>
```
with:
```tsx
              <form action={cancelBroadcast}><input name="id" type="hidden" value={item.id} /><SubmitButton className="btn-secondary" pendingLabel="Cancelling…">Cancel</SubmitButton></form>
```

and:
```tsx
            <form action={cancelBroadcast} className="mt-3"><input name="id" type="hidden" value={item.id} /><button className="btn-secondary" type="submit">Cancel broadcast</button></form>
```
with:
```tsx
            <form action={cancelBroadcast} className="mt-3"><input name="id" type="hidden" value={item.id} /><SubmitButton className="btn-secondary" pendingLabel="Cancelling…">Cancel broadcast</SubmitButton></form>
```

- [ ] **Step 5: `share/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
                      <button
                        type="submit"
                        className="min-h-10 cursor-pointer rounded-[10px] border-none bg-accent px-4.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-deep"
                      >
                        Generate share links
                      </button>
```
with:
```tsx
                      <SubmitButton
                        className="min-h-10 cursor-pointer rounded-[10px] border-none bg-accent px-4.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:opacity-60"
                        pendingLabel="Generating…"
                      >
                        Generate share links
                      </SubmitButton>
```

Replace:
```tsx
                      <button
                        type="submit"
                        className="min-h-9 cursor-pointer rounded-[9px] border border-danger-line bg-white px-3 text-[12.5px] font-semibold text-danger transition-colors hover:bg-danger-tint"
                      >
                        Disconnect
                      </button>
```
with:
```tsx
                      <SubmitButton
                        className="min-h-9 cursor-pointer rounded-[9px] border border-danger-line bg-white px-3 text-[12.5px] font-semibold text-danger transition-colors hover:bg-danger-tint disabled:cursor-wait disabled:opacity-60"
                        pendingLabel="Disconnecting…"
                      >
                        Disconnect
                      </SubmitButton>
```

- [ ] **Step 6: `components/seller/product-media-manager.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
                      <button
                        type="submit"
                        className="min-h-8 cursor-pointer rounded-lg border border-line-strong bg-white px-2.5 text-[12px] font-semibold text-ink transition-colors hover:border-[#B9AC98]"
                      >
                        Make main
                      </button>
```
with:
```tsx
                      <SubmitButton
                        className="min-h-8 cursor-pointer rounded-lg border border-line-strong bg-white px-2.5 text-[12px] font-semibold text-ink transition-colors hover:border-[#B9AC98] disabled:cursor-wait disabled:opacity-60"
                        pendingLabel="Setting…"
                      >
                        Make main
                      </SubmitButton>
```

Replace:
```tsx
                    <button
                      type="submit"
                      className="min-h-8 cursor-pointer rounded-lg border border-danger-line bg-white px-2.5 text-[12px] font-semibold text-danger transition-colors hover:bg-danger-tint"
                    >
                      Remove
                    </button>
```
with:
```tsx
                    <SubmitButton
                      className="min-h-8 cursor-pointer rounded-lg border border-danger-line bg-white px-2.5 text-[12px] font-semibold text-danger transition-colors hover:bg-danger-tint disabled:cursor-wait disabled:opacity-60"
                      pendingLabel="Removing…"
                    >
                      Remove
                    </SubmitButton>
```

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(seller)/dashboard/growth/promotions/page.tsx" "src/app/(seller)/dashboard/growth/segments/page.tsx" "src/app/(seller)/dashboard/growth/campaigns/page.tsx" "src/app/(seller)/dashboard/growth/broadcasts/page.tsx" "src/app/(seller)/dashboard/share/page.tsx" src/components/seller/product-media-manager.tsx
git commit -m "feat: add pending-state feedback to growth, share, and product-media forms"
```

---

### Task 4: Retrofit product edit page (simple forms + variant Save/Hide multi-button)

**Files:**
- Modify: `src/app/(seller)/dashboard/products/[productId]/page.tsx`

**Interfaces:**
- Consumes: `SubmitButton`, `FormActionButton` from `@/components/ui/submit-button` (Task 1).

- [ ] **Step 1: Add the import**

```tsx
import { FormActionButton, SubmitButton } from "@/components/ui/submit-button";
```

- [ ] **Step 2: Retrofit the simple forms**

Replace:
```tsx
        <button className="btn-primary w-full" type="submit">Save product</button>
```
with:
```tsx
        <SubmitButton className="btn-primary w-full" pendingLabel="Saving…">Save product</SubmitButton>
```

Replace:
```tsx
          <button className="btn-primary w-full" type="submit">Save video</button>
```
with:
```tsx
          <SubmitButton className="btn-primary w-full" pendingLabel="Saving…">Save video</SubmitButton>
```

Replace:
```tsx
            <button className="btn-secondary w-full" type="submit">Remove video</button>
```
with:
```tsx
            <SubmitButton className="btn-secondary w-full" pendingLabel="Removing…">Remove video</SubmitButton>
```

Replace:
```tsx
          <button className="btn-primary w-full" type="submit">Add variant</button>
```
with:
```tsx
          <SubmitButton className="btn-primary w-full" pendingLabel="Adding…">Add variant</SubmitButton>
```

- [ ] **Step 3: Retrofit the variant Save/Hide multi-button form**

This form has two buttons sharing one `<form>`: the default submit (`updateVariantAction`, from the form's own `action`) and a second button that overrides via its own `formAction={archiveVariantAction}`. Use `FormActionButton`'s `formAction`-matching mode for both, passing each button's own action reference so only the clicked one shows its own pending label.

Replace:
```tsx
            <div className="flex gap-2"><button className="btn-primary flex-1" type="submit">Save variant</button><button className="btn-secondary" formAction={archiveVariantAction} type="submit">Hide</button></div>
```
with:
```tsx
            <div className="flex gap-2"><FormActionButton className="btn-primary flex-1" formAction={updateVariantAction} pendingLabel="Saving…">Save variant</FormActionButton><FormActionButton className="btn-secondary" formAction={archiveVariantAction} pendingLabel="Hiding…">Hide</FormActionButton></div>
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 5: Manual verification of the multi-button matching (no automated test — Task 1's tests already cover `FormActionButton`'s formAction-matching logic in isolation; this step confirms the real usage compiles and the `updateVariantAction` reference passed into `FormActionButton`'s default-button instance is stable across renders)**

Run: `pnpm typecheck` (already run in Step 4) — a type error here would mean `formAction={updateVariantAction}` on the default button doesn't match `FormActionButton`'s `formAction` prop type; since `updateVariantAction` is the form's own `action` too, passing it explicitly as `formAction` on the first button is redundant but harmless (React allows a button's `formAction` to equal its form's `action`) and is what makes `useFormStatus().action === formAction` resolve correctly for THIS button specifically when it's the one that was clicked.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(seller)/dashboard/products/[productId]/page.tsx"
git commit -m "feat: add pending-state feedback to the product edit page"
```

---

### Task 5: Retrofit the products-list publish/hide toggle switch

**Files:**
- Create: `src/components/seller/product-status-toggle.tsx`
- Modify: `src/app/(seller)/dashboard/products/page.tsx`

**Interfaces:**
- Produces: `ProductStatusToggle({ checked, ariaLabel, title })` — a `"use client"` wrapper around the existing switch markup, consumed only by `products/page.tsx`.

The toggle switch needs a different treatment than a label swap (it's a visual on/off control, not a text button) — dim it and block interaction while pending, keeping its exact current visual design otherwise.

- [ ] **Step 1: Create the toggle component**

```tsx
// src/components/seller/product-status-toggle.tsx
"use client";

import { useFormStatus } from "react-dom";

/**
 * The publish/hide switch on the products list. Its <button> lives inside
 * a <form action={setProductStatusAction}> in the parent server component —
 * this client wrapper is what lets it read useFormStatus() and dim/disable
 * itself while the toggle is in flight, without turning the whole list row
 * into a client component.
 */
export function ProductStatusToggle({
  checked,
  ariaLabel,
  title,
}: {
  checked: boolean;
  ariaLabel: string;
  title: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`relative h-[26px] w-11 rounded-full border-none p-0 transition-colors disabled:cursor-wait disabled:opacity-60 ${
        pending ? "" : "cursor-pointer"
      } ${checked ? "bg-accent" : "bg-line-strong"}`}
      disabled={pending}
      role="switch"
      title={title}
      type="submit"
    >
      <span
        className="absolute top-0.5 block h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(33,27,20,0.25)] transition-[left]"
        style={{ left: checked ? "20px" : "2px" }}
      />
    </button>
  );
}
```

- [ ] **Step 2: Wire it into `products/page.tsx`**

Add import: `import { ProductStatusToggle } from "@/components/seller/product-status-toggle";`

Replace:
```tsx
                <form action={setProductStatusAction} className="flex-none">
                  <input name="productId" type="hidden" value={product.id} />
                  <input name="status" type="hidden" value={isActive ? "draft" : "active"} />
                  <button
                    type="submit"
                    role="switch"
                    aria-checked={isActive}
                    aria-label={isActive ? `Hide ${product.name}` : `Publish ${product.name}`}
                    title={isActive ? "Hide product" : "Publish product"}
                    className={`relative h-[26px] w-11 cursor-pointer rounded-full border-none p-0 transition-colors ${
                      isActive ? "bg-accent" : "bg-line-strong"
                    }`}
                  >
                    <span
                      className="absolute top-0.5 block h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(33,27,20,0.25)] transition-[left]"
                      style={{ left: isActive ? "20px" : "2px" }}
                    />
                  </button>
                </form>
```
with:
```tsx
                <form action={setProductStatusAction} className="flex-none">
                  <input name="productId" type="hidden" value={product.id} />
                  <input name="status" type="hidden" value={isActive ? "draft" : "active"} />
                  <ProductStatusToggle
                    ariaLabel={isActive ? `Hide ${product.name}` : `Publish ${product.name}`}
                    checked={isActive}
                    title={isActive ? "Hide product" : "Publish product"}
                  />
                </form>
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/seller/product-status-toggle.tsx "src/app/(seller)/dashboard/products/page.tsx"
git commit -m "feat: dim the products-list publish/hide toggle while its request is in flight"
```

---

### Task 6: Retrofit order status-transition buttons

**Files:**
- Modify: `src/components/seller/order-actions.tsx`

**Interfaces:**
- Consumes: `SubmitButton` from `@/components/ui/submit-button` (Task 1).

Each status transition renders its OWN separate `<form>` (not multiple buttons sharing one form), so `SubmitButton` alone is correct here — no multi-button matching needed. The cancel-order form's `onSubmit` confirm-dialog gate stays exactly as-is; it fires before the button's own pending state is ever reached (the browser blocks the submission entirely if the user declines the confirm), so it composes with `SubmitButton` with no changes needed to that logic.

- [ ] **Step 1: Add the import**

```tsx
import { SubmitButton } from "@/components/ui/submit-button";
```

- [ ] **Step 2: Retrofit the transition button**

Replace:
```tsx
          <button
            className={next === "cancelled" ? "btn-danger" : "btn-secondary"}
            type="submit"
          >
            {next === "cancelled" ? "Cancel order" : next === "confirmed" ? "Confirm" : next === "processing" ? "Mark processing" : next === "completed" ? "Mark complete" : next}
          </button>
```
with:
```tsx
          <SubmitButton
            className={next === "cancelled" ? "btn-danger" : "btn-secondary"}
            pendingLabel={next === "cancelled" ? "Cancelling…" : next === "confirmed" ? "Confirming…" : next === "processing" ? "Updating…" : next === "completed" ? "Completing…" : "Working…"}
          >
            {next === "cancelled" ? "Cancel order" : next === "confirmed" ? "Confirm" : next === "processing" ? "Mark processing" : next === "completed" ? "Mark complete" : next}
          </SubmitButton>
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/seller/order-actions.tsx
git commit -m "feat: add pending-state feedback to order status-transition buttons"
```

---

### Task 7: Retrofit billing/plan-change buttons

**Files:**
- Modify: `src/app/(seller)/dashboard/settings/billing/page.tsx`

**Interfaces:**
- Consumes: `SubmitButton` from `@/components/ui/submit-button` (Task 1).

Each plan card renders its own independent `<form>` (`cancelSubscription` or `changePlan`), so `SubmitButton` per form is correct — no cross-form coordination is added (each button independently reflecting its own form's pending state is sufficient feedback; locking sibling cards while one submits is out of scope for this plan per YAGNI).

- [ ] **Step 1: Add the import**

```tsx
import { SubmitButton } from "@/components/ui/submit-button";
```

- [ ] **Step 2: Retrofit "Cancel renewal"**

Replace:
```tsx
              <form action={cancelSubscription}>
                <button
                  type="submit"
                  className="min-h-10 cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-danger transition-colors hover:border-danger"
                >
                  Cancel renewal
                </button>
              </form>
```
with:
```tsx
              <form action={cancelSubscription}>
                <SubmitButton
                  className="min-h-10 cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-danger transition-colors hover:border-danger disabled:cursor-wait disabled:opacity-60"
                  pendingLabel="Cancelling…"
                >
                  Cancel renewal
                </SubmitButton>
              </form>
```

- [ ] **Step 3: Retrofit "Switch to Free"**

Replace:
```tsx
                      <form action={changePlan}>
                        <input name="planCode" type="hidden" value="free" />
                        <button
                          type="submit"
                          className="min-h-11 w-full cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13.5px] font-bold text-ink transition-colors hover:border-[#B9AC98]"
                        >
                          Switch to Free — takes effect {renewsAt ?? "at period end"}
                        </button>
                      </form>
```
with:
```tsx
                      <form action={changePlan}>
                        <input name="planCode" type="hidden" value="free" />
                        <SubmitButton
                          className="min-h-11 w-full cursor-pointer rounded-[10px] border border-line-strong bg-white px-4 text-[13.5px] font-bold text-ink transition-colors hover:border-[#B9AC98] disabled:cursor-wait disabled:opacity-60"
                          pendingLabel="Switching…"
                        >
                          Switch to Free — takes effect {renewsAt ?? "at period end"}
                        </SubmitButton>
                      </form>
```

- [ ] **Step 4: Retrofit the paid-plan upgrade/switch button**

Replace:
```tsx
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
```
with:
```tsx
                      <SubmitButton
                        className={`min-h-11 cursor-pointer rounded-[10px] px-4 text-[13.5px] font-bold transition-colors disabled:cursor-wait disabled:opacity-60 ${
                          featured
                            ? "border-none bg-accent text-white hover:bg-accent-deep"
                            : "border border-line-strong bg-white text-ink hover:border-[#B9AC98]"
                        }`}
                        pendingLabel={isUpgradeTarget ? "Redirecting to payment…" : "Switching…"}
                      >
                        {isUpgradeTarget ? `Upgrade to ${row.name}` : `Switch to ${row.name} — takes effect ${renewsAt ?? "at period end"}`}
                      </SubmitButton>
```

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(seller)/dashboard/settings/billing/page.tsx"
git commit -m "feat: add pending-state feedback to billing plan-change buttons"
```

---

### Task 8: Retrofit admin simple forms (products list, plans, cases)

**Files:**
- Modify: `src/app/admin/products/page.tsx`
- Modify: `src/app/admin/plans/page.tsx`
- Modify: `src/app/admin/cases/[caseId]/page.tsx`

**Interfaces:**
- Consumes: `SubmitButton` from `@/components/ui/submit-button` (Task 1).

- [ ] **Step 1: `admin/products/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
              <button
                type="submit"
                className="h-10 cursor-pointer rounded-[10px] border-none bg-ink px-4 text-[13px] font-semibold text-white transition-colors hover:bg-ink-2"
              >
                Add category
              </button>
```
with:
```tsx
              <SubmitButton
                className="h-10 cursor-pointer rounded-[10px] border-none bg-ink px-4 text-[13px] font-semibold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
                pendingLabel="Adding…"
              >
                Add category
              </SubmitButton>
```

Replace:
```tsx
                    <form action={setCategoryActiveAction}>
                      <input name="categoryId" type="hidden" value={category.id} />
                      <input name="active" type="hidden" value={category.active ? "false" : "true"} />
                      <button
                        type="submit"
                        className="text-[12.5px] font-semibold text-accent hover:underline"
                      >
                        {category.active ? "Archive" : "Restore"}
                      </button>
                    </form>
```
with:
```tsx
                    <form action={setCategoryActiveAction}>
                      <input name="categoryId" type="hidden" value={category.id} />
                      <input name="active" type="hidden" value={category.active ? "false" : "true"} />
                      <SubmitButton
                        className="text-[12.5px] font-semibold text-accent hover:underline disabled:cursor-wait disabled:opacity-60"
                        pendingLabel={category.active ? "Archiving…" : "Restoring…"}
                      >
                        {category.active ? "Archive" : "Restore"}
                      </SubmitButton>
                    </form>
```

- [ ] **Step 2: `admin/plans/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
                        <button
                          type="submit"
                          className="min-h-9 cursor-pointer justify-self-start rounded-[9px] border-none bg-ink px-3.5 text-[12.5px] font-bold text-white transition-colors hover:bg-ink-2"
                        >
                          Save price
                        </button>
```
with:
```tsx
                        <SubmitButton
                          className="min-h-9 cursor-pointer justify-self-start rounded-[9px] border-none bg-ink px-3.5 text-[12.5px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
                          pendingLabel="Saving…"
                        >
                          Save price
                        </SubmitButton>
```

- [ ] **Step 3: `admin/cases/[caseId]/page.tsx`**

Add import: `import { SubmitButton } from "@/components/ui/submit-button";`

Replace:
```tsx
                <button
                  type="submit"
                  className="min-h-10 cursor-pointer justify-self-start rounded-[10px] border-none bg-ink px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-ink-2"
                >
                  Post message
                </button>
```
with:
```tsx
                <SubmitButton
                  className="min-h-10 cursor-pointer justify-self-start rounded-[10px] border-none bg-ink px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
                  pendingLabel="Posting…"
                >
                  Post message
                </SubmitButton>
```

Replace:
```tsx
              <button
                type="submit"
                className="min-h-11 cursor-pointer rounded-[10px] border-none bg-accent px-4.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-deep"
              >
                Update case
              </button>
```
with:
```tsx
              <SubmitButton
                className="min-h-11 cursor-pointer rounded-[10px] border-none bg-accent px-4.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:opacity-60"
                pendingLabel="Updating…"
              >
                Update case
              </SubmitButton>
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/products/page.tsx src/app/admin/plans/page.tsx "src/app/admin/cases/[caseId]/page.tsx"
git commit -m "feat: add pending-state feedback to admin products/plans/cases forms"
```

---

### Task 9: Retrofit admin multi-button forms (product moderation, payouts, seller risk/verification)

**Files:**
- Modify: `src/app/admin/products/[productId]/page.tsx`
- Modify: `src/app/admin/payouts/page.tsx`
- Modify: `src/app/admin/sellers/[sellerId]/page.tsx`

**Interfaces:**
- Consumes: `SubmitButton`, `FormActionButton` from `@/components/ui/submit-button` (Task 1).

- [ ] **Step 1: `admin/products/[productId]/page.tsx`**

Add import: `import { FormActionButton, SubmitButton } from "@/components/ui/submit-button";`

The moderation form has 3 buttons sharing one `<form action={setProductModerationAction}>`, discriminated by their own `name="decision" value="..."` — use `FormActionButton`'s name/value-matching mode. Replace:
```tsx
            <div className="flex flex-wrap gap-2.5">
              {MODERATION_ACTIONS.map((action) => (
                <button
                  key={action.value}
                  type="submit"
                  name="decision"
                  value={action.value}
                  className={`min-h-10 cursor-pointer rounded-[10px] px-4.5 text-[13px] font-bold transition-colors ${
                    action.tone === "danger"
                      ? "border-none bg-danger text-white hover:opacity-90"
                      : action.tone === "success"
                        ? "border border-line-strong bg-white text-ink hover:border-[#B9AC98]"
                        : "border-none bg-warn text-white hover:opacity-90"
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
```
with:
```tsx
            <div className="flex flex-wrap gap-2.5">
              {MODERATION_ACTIONS.map((action) => (
                <FormActionButton
                  key={action.value}
                  name="decision"
                  value={action.value}
                  pendingLabel={`${action.label}…`}
                  className={`min-h-10 cursor-pointer rounded-[10px] px-4.5 text-[13px] font-bold transition-colors disabled:cursor-wait disabled:opacity-60 ${
                    action.tone === "danger"
                      ? "border-none bg-danger text-white hover:opacity-90"
                      : action.tone === "success"
                        ? "border border-line-strong bg-white text-ink hover:border-[#B9AC98]"
                        : "border-none bg-warn text-white hover:opacity-90"
                  }`}
                >
                  {action.label}
                </FormActionButton>
              ))}
            </div>
```

The categories form is single-button — replace:
```tsx
            <button
              type="submit"
              className="min-h-10 w-fit cursor-pointer rounded-[10px] border-none bg-ink px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-ink-2"
            >
              Save categories
            </button>
```
with:
```tsx
            <SubmitButton
              className="min-h-10 w-fit cursor-pointer rounded-[10px] border-none bg-ink px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
              pendingLabel="Saving…"
            >
              Save categories
            </SubmitButton>
```

- [ ] **Step 2: `admin/payouts/page.tsx`**

Add import: `import { FormActionButton } from "@/components/ui/submit-button";`

This form has 2 buttons sharing one `<form action={reviewPayoutAction}>` (Approve-or-Mark-as-paid, plus Reject), discriminated by `name="decision" value="..."`. Replace:
```tsx
                      <div className="flex flex-wrap gap-2.5">
                        {payout.status === "requested" ? (
                          <button
                            type="submit"
                            name="decision"
                            value="approved"
                            className="min-h-10 cursor-pointer rounded-[10px] border-none bg-success px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-success-deep"
                          >
                            Approve
                          </button>
                        ) : (
                          <button
                            type="submit"
                            name="decision"
                            value="paid"
                            className="min-h-10 cursor-pointer rounded-[10px] border-none bg-success px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-success-deep"
                          >
                            Mark as paid
                          </button>
                        )}
                        <button
                          type="submit"
                          name="decision"
                          value="rejected"
                          className="min-h-10 cursor-pointer rounded-[10px] border border-danger-line bg-white px-4.5 text-[13px] font-bold text-danger transition-colors hover:bg-danger-tint"
                        >
                          Reject
                        </button>
                      </div>
```
with:
```tsx
                      <div className="flex flex-wrap gap-2.5">
                        {payout.status === "requested" ? (
                          <FormActionButton
                            name="decision"
                            value="approved"
                            pendingLabel="Approving…"
                            className="min-h-10 cursor-pointer rounded-[10px] border-none bg-success px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-success-deep disabled:cursor-wait disabled:opacity-60"
                          >
                            Approve
                          </FormActionButton>
                        ) : (
                          <FormActionButton
                            name="decision"
                            value="paid"
                            pendingLabel="Marking as paid…"
                            className="min-h-10 cursor-pointer rounded-[10px] border-none bg-success px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-success-deep disabled:cursor-wait disabled:opacity-60"
                          >
                            Mark as paid
                          </FormActionButton>
                        )}
                        <FormActionButton
                          name="decision"
                          value="rejected"
                          pendingLabel="Rejecting…"
                          className="min-h-10 cursor-pointer rounded-[10px] border border-danger-line bg-white px-4.5 text-[13px] font-bold text-danger transition-colors hover:bg-danger-tint disabled:cursor-wait disabled:opacity-60"
                        >
                          Reject
                        </FormActionButton>
                      </div>
```

- [ ] **Step 3: `admin/sellers/[sellerId]/page.tsx`**

Add import: `import { FormActionButton, SubmitButton } from "@/components/ui/submit-button";`

The verification form has 2 buttons sharing one `<form action={approveVerificationAction}>`, discriminated by `name="decision" value="..."`. Replace:
```tsx
            <div className="flex flex-wrap gap-2.5">
              <button
                type="submit"
                name="decision"
                value="verified"
                className="min-h-10 cursor-pointer rounded-[10px] border-none bg-success px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-success-deep"
              >
                Approve verification
              </button>
              <button
                type="submit"
                name="decision"
                value="rejected"
                className="min-h-10 cursor-pointer rounded-[10px] border border-danger-line bg-white px-4.5 text-[13px] font-bold text-danger transition-colors hover:bg-danger-tint"
              >
                Reject
              </button>
            </div>
```
with:
```tsx
            <div className="flex flex-wrap gap-2.5">
              <FormActionButton
                name="decision"
                value="verified"
                pendingLabel="Approving…"
                className="min-h-10 cursor-pointer rounded-[10px] border-none bg-success px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-success-deep disabled:cursor-wait disabled:opacity-60"
              >
                Approve verification
              </FormActionButton>
              <FormActionButton
                name="decision"
                value="rejected"
                pendingLabel="Rejecting…"
                className="min-h-10 cursor-pointer rounded-[10px] border border-danger-line bg-white px-4.5 text-[13px] font-bold text-danger transition-colors hover:bg-danger-tint disabled:cursor-wait disabled:opacity-60"
              >
                Reject
              </FormActionButton>
            </div>
```

The discovery-removal form only ever renders ONE button at a time (a ternary, not sibling buttons) — it's a simple case. `SubmitButton` does not accept `name`/`value` props (it's designed for exactly one action per form), so the existing `name="decision" value="..."` moves off the button and onto a new hidden input carrying the same value, matching the pattern already used elsewhere in this same file (e.g. `<input name="sellerId" type="hidden" value={seller.id} />` a few lines above this block).

Replace:
```tsx
          <form action={setDiscoveryRemovalAction} className="grid gap-3">
            <input name="sellerId" type="hidden" value={seller.id} />
            <label className="grid gap-1.5 text-[12.5px] font-semibold text-ink" htmlFor="discovery-reason">
              Operational reason (required)
              <textarea
                id="discovery-reason"
                name="reason"
                required
                rows={2}
                placeholder="e.g. Listing violates content policy — counterfeit goods reported"
                className="w-full resize-y rounded-[10px] border border-line-input bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <div className="flex flex-wrap gap-2.5">
              {discoveryPreference.operator_removed_at ? (
                <button
                  type="submit"
                  name="decision"
                  value="restore"
                  className="min-h-10 cursor-pointer rounded-[10px] border-none bg-success px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-success-deep"
                >
                  Restore listing
                </button>
              ) : (
                <button
                  type="submit"
                  name="decision"
                  value="remove"
                  className="min-h-10 cursor-pointer rounded-[10px] border border-danger-line bg-white px-4.5 text-[13px] font-bold text-danger transition-colors hover:bg-danger-tint"
                >
                  Remove from discovery
                </button>
              )}
            </div>
          </form>
```
with:
```tsx
          <form action={setDiscoveryRemovalAction} className="grid gap-3">
            <input name="sellerId" type="hidden" value={seller.id} />
            <input name="decision" type="hidden" value={discoveryPreference.operator_removed_at ? "restore" : "remove"} />
            <label className="grid gap-1.5 text-[12.5px] font-semibold text-ink" htmlFor="discovery-reason">
              Operational reason (required)
              <textarea
                id="discovery-reason"
                name="reason"
                required
                rows={2}
                placeholder="e.g. Listing violates content policy — counterfeit goods reported"
                className="w-full resize-y rounded-[10px] border border-line-input bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <div className="flex flex-wrap gap-2.5">
              {discoveryPreference.operator_removed_at ? (
                <SubmitButton
                  className="min-h-10 cursor-pointer rounded-[10px] border-none bg-success px-4.5 text-[13px] font-bold text-white transition-colors hover:bg-success-deep disabled:cursor-wait disabled:opacity-60"
                  pendingLabel="Restoring…"
                >
                  Restore listing
                </SubmitButton>
              ) : (
                <SubmitButton
                  className="min-h-10 cursor-pointer rounded-[10px] border border-danger-line bg-white px-4.5 text-[13px] font-bold text-danger transition-colors hover:bg-danger-tint disabled:cursor-wait disabled:opacity-60"
                  pendingLabel="Removing…"
                >
                  Remove from discovery
                </SubmitButton>
              )}
            </div>
          </form>
```

The risk-action form is single-button (behind a required checkbox, native HTML validation — no changes needed to that gating). Replace:
```tsx
            <button
              type="submit"
              className="min-h-11 cursor-pointer rounded-[10px] border-none bg-danger px-4.5 text-[13.5px] font-bold text-white transition-opacity hover:opacity-90"
            >
              Apply risk action
            </button>
```
with:
```tsx
            <SubmitButton
              className="min-h-11 cursor-pointer rounded-[10px] border-none bg-danger px-4.5 text-[13.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
              pendingLabel="Applying…"
            >
              Apply risk action
            </SubmitButton>
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/admin/products/[productId]/page.tsx" src/app/admin/payouts/page.tsx "src/app/admin/sellers/[sellerId]/page.tsx"
git commit -m "feat: add pending-state feedback to admin moderation, payout, and seller-risk forms"
```

---

### Task 10: Full verification pass

**Files:** none — this task runs checks across everything built in Tasks 1–9.

- [ ] **Step 1: Run the full automated suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: typecheck clean, lint clean, all vitest suites pass (no existing test should be affected — every change in this plan is additive JSX swapping one component for another with equivalent DOM output when not pending).

- [ ] **Step 2: Manual spot-check on local dev**

Run: `pnpm dev:local`. Using the browse skill:
1. Log in as a seller, navigate to Settings → Notifications, submit the form, and confirm the button briefly shows "Saving…" and is disabled during the request.
2. Navigate to the product edit page for a product with at least one variant, click "Hide" on a variant, and confirm ONLY the "Hide" button shows "Hiding…" while "Save variant" stays showing its normal label (verifies `FormActionButton`'s formAction-matching in real usage, not just the Task 1 unit tests).
3. Navigate to the products list, click the publish/hide toggle, and confirm it dims during the request.
4. Log in as an admin (or an operator test account), open a product's moderation panel, click one of the 3 moderation buttons, and confirm only the clicked button shows its own pending label while the other two are disabled but unchanged in text (verifies `FormActionButton`'s name/value-matching in real usage).
5. On the order actions component (any order with valid transitions), click "Cancel order" and confirm the browser's confirm dialog still appears BEFORE any pending state, and cancelling the dialog leaves the button in its normal state (verifies the `onSubmit` confirm gate still composes correctly with `SubmitButton`).

- [ ] **Step 3: Report results**

No commit for this task — it's verification only. If any check fails, return to the relevant task above and fix before considering the plan complete.
