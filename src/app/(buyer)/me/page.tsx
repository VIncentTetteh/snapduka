import Link from "next/link";

import { ActionBanner } from "@/components/ui/action-banner";
import { SubmitButton } from "@/components/ui/submit-button";
import { safeNextPath } from "@/lib/auth/redirect";
import { SHARED_PROFILE_CONSENT_POINTS, SHARED_PROFILE_CONSENT_VERSION } from "@/lib/buyer/consent";
import { getBuyerSession } from "@/lib/buyer/session";

import { grantConsentAction, updateDisplayNameAction } from "./account-actions";
import { CARD, INPUT, LABEL, PageTitle, PRIMARY, SECONDARY, SignOutButton, first, type SearchParams } from "./shared";
import { sendBuyerOtpAction, signOutBuyerAction, verifyBuyerOtpAction } from "./sign-in-actions";

/**
 * /me — phone sign-in for guests, and the account home for buyers.
 *
 * getBuyerSession() provisions the profile on the first visit after a verified
 * sign-in and, once the buyer has consented, claims matching guest orders.
 */
export default async function MePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const error = first(params.error);
  const message = first(params.message);
  const next = safeNextPath(first(params.next), "/me");
  const session = await getBuyerSession();

  if (session.state === "anonymous" || session.state === "needs_phone") {
    const isCodeStep = first(params.step) === "code";
    return (
      <>
        <PageTitle
          title={isCodeStep ? "Enter your code" : "Your orders, from every shop"}
          sub={
            isCodeStep
              ? "We sent a 6-digit code by SMS."
              : "Sign in with your phone number to see orders from any SnapDuka shop in one place and check out faster. No password."
          }
        />
        <ActionBanner error={error} saved={message} />
        {session.state === "needs_phone" && !isCodeStep ? (
          <p className="mb-4 rounded-[10px] border border-line bg-raised px-3.5 py-3 text-[13px] text-ink-soft">
            You are signed in without a phone number. Add one below to use it for your buyer profile too.
          </p>
        ) : null}
        <div className={CARD}>
          {isCodeStep ? (
            <form action={verifyBuyerOtpAction} className="grid gap-3.5">
              <input type="hidden" name="phone" value={first(params.phone) ?? ""} />
              <input type="hidden" name="mode" value={first(params.mode) ?? "signin"} />
              <input type="hidden" name="next" value={next} />
              <label className={LABEL}>
                <span>6-digit code</span>
                <input
                  className={INPUT}
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  required
                />
              </label>
              <SubmitButton className={PRIMARY} pendingLabel="Verifying…">
                Verify and continue
              </SubmitButton>
              <Link href={`/me?${new URLSearchParams({ next })}`} className="text-[12.5px] font-semibold text-ink-soft underline">
                Use a different number
              </Link>
            </form>
          ) : (
            <form action={sendBuyerOtpAction} className="grid gap-3.5">
              <input type="hidden" name="next" value={next} />
              <div className="grid grid-cols-[auto_1fr] gap-2">
                <label className={LABEL}>
                  <span>Country</span>
                  <select name="region" defaultValue="GH" className={`${INPUT} w-auto`}>
                    <option value="GH">Ghana +233</option>
                    <option value="NG">Nigeria +234</option>
                    <option value="CI">Côte d’Ivoire +225</option>
                  </select>
                </label>
                <label className={LABEL}>
                  <span>Phone number</span>
                  <input className={INPUT} name="phone" type="tel" autoComplete="tel" placeholder="024 123 4567" required />
                </label>
              </div>
              <SubmitButton className={PRIMARY} pendingLabel="Sending code…">
                Send code
              </SubmitButton>
              <p className="text-[12px] leading-[1.5] text-ink-muted">
                Shopping as a guest still works exactly as before; an account is optional.
              </p>
            </form>
          )}
        </div>
      </>
    );
  }

  if (session.state !== "buyer") {
    return (
      <>
        <PageTitle title="We could not open your profile" />
        <div className={CARD}>
          <p className="mb-4 text-[14px] leading-[1.6] text-ink-soft">
            {session.state === "phone_in_use"
              ? "This phone number is already linked to another SnapDuka buyer profile. Sign in with that number's own login, or contact support."
              : "Something went wrong on our side. Please try again in a moment."}
          </p>
          <form action={signOutBuyerAction}>
            <button type="submit" className={SECONDARY}>
              Sign out
            </button>
          </form>
        </div>
      </>
    );
  }

  const { buyer, client } = session;
  const { data: profile } = await client
    .from("buyer_profiles")
    .select("display_name")
    .eq("id", buyer.buyerProfileId)
    .maybeSingle();

  return (
    <>
      <PageTitle title={profile?.display_name ? `Hello, ${profile.display_name}` : "Your SnapDuka account"} sub={`Signed in as ${buyer.phone}`} />
      <ActionBanner error={error} saved={message} />

      {!buyer.consented ? (
        <section className={CARD} aria-labelledby="consent-heading">
          <h2 id="consent-heading" className="mb-2 text-[15px] font-bold">
            Bring your orders together
          </h2>
          <ul className="mb-4 grid list-disc gap-1.5 pl-5 text-[13.5px] leading-[1.55] text-ink-soft">
            {SHARED_PROFILE_CONSENT_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <form action={grantConsentAction}>
            <input type="hidden" name="version" value={SHARED_PROFILE_CONSENT_VERSION} />
            <SubmitButton className={PRIMARY} pendingLabel="Saving…">
              I agree — link my orders
            </SubmitButton>
          </form>
          <p className="mt-2 text-[12px] text-ink-muted">
            Not now? You can still sign in and save addresses. Nothing is linked until you agree.
          </p>
        </section>
      ) : null}

      <section className={CARD} aria-labelledby="name-heading">
        <h2 id="name-heading" className="mb-3 text-[15px] font-bold">
          Your name
        </h2>
        <form action={updateDisplayNameAction} className="flex flex-wrap items-end gap-2">
          <label className={`${LABEL} min-w-0 flex-1`}>
            <span className="sr-only">Name</span>
            <input className={INPUT} name="displayName" defaultValue={profile?.display_name ?? ""} maxLength={120} placeholder="Name for checkout" />
          </label>
          <SubmitButton className={SECONDARY} pendingLabel="Saving…">
            Save
          </SubmitButton>
        </form>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/me/orders" className={`${CARD} mb-0 font-semibold hover:border-line-strong`}>
          Orders →
        </Link>
        <Link href="/me/addresses" className={`${CARD} mb-0 font-semibold hover:border-line-strong`}>
          Addresses →
        </Link>
        <Link href="/me/privacy" className={`${CARD} mb-0 font-semibold hover:border-line-strong`}>
          Privacy &amp; data →
        </Link>
      </div>

      <div className="mt-6">
        <SignOutButton />
      </div>
    </>
  );
}
