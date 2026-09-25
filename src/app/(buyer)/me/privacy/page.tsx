import { ActionBanner } from "@/components/ui/action-banner";
import { SubmitButton } from "@/components/ui/submit-button";
import { SHARED_PROFILE_CONSENT_POINTS, SHARED_PROFILE_CONSENT_VERSION } from "@/lib/buyer/consent";
import { getBuyerSession } from "@/lib/buyer/session";

import { deleteBuyerProfileAction, grantConsentAction, withdrawConsentAction } from "../account-actions";
import { CARD, INPUT, LABEL, PageTitle, PRIMARY, SECONDARY, SignInPrompt, first, type SearchParams } from "../shared";

/**
 * Privacy controls required for the shared profile under Act 843: the consent
 * text and its current state, access (download), withdrawal and erasure.
 */
export default async function BuyerPrivacyPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const session = await getBuyerSession({ claimOnResolve: false });
  if (session.state !== "buyer") {
    return (
      <>
        <PageTitle title="Privacy & your data" />
        <SignInPrompt />
      </>
    );
  }

  const { buyer, client } = session;
  const { data: profile } = await client
    .from("buyer_profiles")
    .select("consent_shared_profile_at,consent_version")
    .eq("id", buyer.buyerProfileId)
    .maybeSingle();

  return (
    <>
      <PageTitle title="Privacy & your data" />
      <ActionBanner error={first(params.error)} saved={first(params.message)} />

      <section className={CARD} aria-labelledby="consent-heading">
        <h2 id="consent-heading" className="mb-2 text-[15px] font-bold">
          Your shared SnapDuka profile
        </h2>
        <ul className="mb-4 grid list-disc gap-1.5 pl-5 text-[13.5px] leading-[1.55] text-ink-soft">
          {SHARED_PROFILE_CONSENT_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        {profile?.consent_shared_profile_at ? (
          <>
            <p className="mb-3 text-[13px] text-ink">
              You agreed on {new Date(profile.consent_shared_profile_at).toLocaleDateString("en-GH", { dateStyle: "long" })}{" "}
              <span className="text-ink-muted">(version {profile.consent_version})</span>.
            </p>
            <form action={withdrawConsentAction}>
              <SubmitButton className={SECONDARY} pendingLabel="Saving…">
                Withdraw consent and unlink my orders
              </SubmitButton>
            </form>
          </>
        ) : (
          <form action={grantConsentAction}>
            <input type="hidden" name="version" value={SHARED_PROFILE_CONSENT_VERSION} />
            <SubmitButton className={PRIMARY} pendingLabel="Saving…">
              I agree — link my orders
            </SubmitButton>
          </form>
        )}
      </section>

      <section className={CARD} aria-labelledby="export-heading">
        <h2 id="export-heading" className="mb-2 text-[15px] font-bold">
          Download your data
        </h2>
        <p className="mb-3 text-[13.5px] leading-[1.55] text-ink-soft">
          A JSON file with your profile, saved addresses, saved payment methods (masked) and linked orders.
        </p>
        {/* A plain link: the route streams a file download and is rate limited. */}
        <a href="/api/buyer/export" className={SECONDARY} download>
          Download my data
        </a>
      </section>

      <section className="rounded-[14px] border border-danger-line bg-white p-5" aria-labelledby="delete-heading">
        <h2 id="delete-heading" className="mb-2 text-[15px] font-bold text-danger">
          Delete my buyer profile
        </h2>
        <p className="mb-3 text-[13.5px] leading-[1.55] text-ink-soft">
          This deletes your profile, saved addresses and saved payment methods now, and unlinks your orders. Shops keep
          their own record of orders you placed with them, as they need to for receipts, refunds and tax. You can sign
          in again later and start a new profile.
        </p>
        <form action={deleteBuyerProfileAction} className="grid gap-3">
          <label className={LABEL}>
            <span>Why are you leaving? <span className="font-normal text-ink-muted">(optional)</span></span>
            <input className={INPUT} name="reason" maxLength={500} />
          </label>
          <label className={LABEL}>
            <span>Type DELETE to confirm</span>
            <input className={INPUT} name="confirm" required autoComplete="off" />
          </label>
          <SubmitButton
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[10px] border border-danger-line bg-white px-5 text-[14.5px] font-semibold text-danger hover:bg-danger-tint"
            pendingLabel="Deleting…"
          >
            Delete my profile
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
