import { redirect } from "next/navigation";

import { closeAccount } from "./actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field, inputClasses } from "@/components/ui/field";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Closing a seller account, from the browser.
 *
 * The mobile app has had this since App Store guideline 5.1.1(v) required it.
 * The web app did not, so a seller who signed up on a browser had no way out
 * except emailing support.
 */
export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; closed?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") redirect("/login?next=/dashboard/settings/account");
  const params = await searchParams;

  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("slug, status")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();

  const closed = params.closed === "1" || shop?.status === "closed";

  return (
    <main className="sd-main mx-auto max-w-[640px] px-4 pt-6 sm:px-6">
      <PageHeader title="Account" sub="Close your SnapDuka account." />

      {params.error ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-[13px] font-semibold text-danger"
        >
          {params.error}
        </div>
      ) : null}

      {closed ? (
        <Panel className="p-4.5">
          <h2 className="mb-2 text-[14px] font-bold text-ink">Your account is closed</h2>
          <p className="text-[13px] leading-[1.6] text-ink-soft">
            Your storefront is offline and nothing more can be sold through it. Personal
            data is erased on our retention schedule; order, payout and commission records
            are kept because they belong to your buyers and creators as much as to you.
            Contact support if you need this reversed.
          </p>
        </Panel>
      ) : (
        <Panel className="p-4.5">
          <h2 className="mb-2 text-[14px] font-bold text-ink">Close this account</h2>
          <p className="mb-3 text-[13px] leading-[1.6] text-ink-soft">
            This takes your storefront offline immediately and closes the account, so
            nothing more can be sold through it. Any creators you work with stop earning.
          </p>
          <p className="mb-4 text-[13px] leading-[1.6] text-ink-soft">
            Orders, ledger entries and creator commissions are kept: they are records of
            transactions involving other people — buyers owed receipts, creators owed
            money — and deleting them would destroy the other side of each one. Personal
            data is erased on our retention schedule.
          </p>

          <form action={closeAccount} className="grid gap-3.5">
            <input name="slug" type="hidden" value={shop?.slug ?? ""} />
            <Field
              label="Why are you leaving?"
              htmlFor="reason"
              help="Optional, and it helps us fix what drove you away."
            >
              <textarea className={inputClasses()} id="reason" name="reason" rows={3} />
            </Field>
            <Field
              label={`Type ${shop?.slug ?? "your store address"} to confirm`}
              htmlFor="confirm"
              help="Typed confirmation, because this cannot be undone from here."
            >
              <input
                autoCapitalize="none"
                autoComplete="off"
                className={inputClasses()}
                id="confirm"
                name="confirm"
                required
              />
            </Field>
            <SubmitButton
              className="min-h-11 cursor-pointer justify-self-start rounded-[10px] border border-danger-line bg-white px-5 text-[13.5px] font-semibold text-danger transition-colors hover:border-danger disabled:cursor-wait disabled:opacity-60"
              pendingLabel="Closing…"
            >
              Close my account
            </SubmitButton>
          </form>
        </Panel>
      )}
    </main>
  );
}
