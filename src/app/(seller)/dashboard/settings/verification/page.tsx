import { redirect } from "next/navigation";

import { startVerificationAction } from "./actions";
import { PageHeader, Panel } from "@/components/ui/surface";
import { buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { resolveServerActor } from "@/lib/auth/actor";
import { getVerificationStatus, type VerificationState } from "@/lib/kyc/service";

export const dynamic = "force-dynamic";

const STATE_COPY: Record<VerificationState, { title: string; body: string }> = {
  not_started: {
    title: "Not verified yet",
    body: "Verified shops show a check next to their name, which buyers look for before paying a shop they have not used.",
  },
  in_progress: {
    title: "Verification in progress",
    body: "We are waiting for the result. This page updates when it arrives — usually within a few minutes.",
  },
  needs_action: {
    title: "We could not verify you",
    body: "The check did not pass. Make sure your Ghana Card is valid and your face is well lit, then try again.",
  },
  verified: {
    title: "Verified",
    body: "Your shop shows the verified check to buyers.",
  },
  rejected: {
    title: "Verification declined",
    body: "Our team reviewed this account and could not verify it. Contact support if you think this is wrong.",
  },
  suspended: {
    title: "Verification on hold",
    body: "This account is under review. Contact support.",
  },
};

const CHECK_LABEL: Record<string, string> = {
  ghana_card: "Ghana Card + selfie",
  liveness: "Selfie check",
  business_reg: "Business registration",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for result",
  passed: "Passed",
  failed: "Did not pass",
  needs_review: "Being reviewed",
  expired: "Expired",
  error: "Could not complete",
};

/**
 * Seller identity verification (flag `kyc_auto`).
 *
 * With the flag off, or no vendor configured, this page only reports the
 * state an operator set — manual approval in /admin remains the path to
 * verified, exactly as before automated KYC existed.
 */
export default async function VerificationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; started?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") redirect("/login?next=/dashboard/settings/verification");
  const params = await searchParams;

  if (actor.role) {
    return (
      <main className="sd-main mx-auto max-w-[640px] px-4 pt-6 sm:px-6">
        <PageHeader title="Verification" sub="Identity verification for this shop." />
        <Panel className="p-4.5">
          <p className="text-[13px] text-ink-soft">Only the account owner can verify their identity.</p>
        </Panel>
      </main>
    );
  }

  const status = await getVerificationStatus({
    sellerAccountId: actor.sellerAccountId,
    country: actor.country,
  });
  const copy = STATE_COPY[status.state];
  const canStart =
    status.automatic === "available" &&
    ["not_started", "needs_action", "in_progress"].includes(status.state) &&
    status.supportedTypes.includes("ghana_card");

  return (
    <main className="sd-main mx-auto max-w-[640px] px-4 pt-6 sm:px-6">
      <PageHeader title="Verification" sub="Show buyers your shop is run by a real, verified person." />

      {params.error ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-[13px] font-semibold text-danger"
        >
          {params.error}
        </div>
      ) : null}

      <Panel className="mb-4 p-4.5">
        <h2 className="mb-2 text-[14px] font-bold text-ink">{copy.title}</h2>
        <p className="text-[13px] leading-[1.6] text-ink-soft">{copy.body}</p>

        {canStart ? (
          <form action={startVerificationAction} className="mt-4 grid gap-2">
            <input type="hidden" name="type" value="ghana_card" />
            <SubmitButton className={buttonClasses("primary", "md", "justify-self-start")} pendingLabel="Starting…">
              {status.state === "needs_action" ? "Try again" : "Verify with Ghana Card"}
            </SubmitButton>
            <p className="text-[12px] text-ink-muted">
              You will photograph your Ghana Card and take a selfie on our verification
              partner&apos;s secure page. SnapDuka never stores your card number or photos —
              only a masked reference and the result.
            </p>
          </form>
        ) : status.automatic !== "available" && status.state !== "verified" ? (
          <p className="mt-3 text-[12.5px] text-ink-muted">
            Automatic verification is coming soon. Until then our team verifies shops by hand.
          </p>
        ) : null}
      </Panel>

      {status.checks.length > 0 ? (
        <Panel className="p-4.5">
          <h2 className="mb-3 text-[14px] font-bold text-ink">Recent checks</h2>
          <ul className="grid gap-2.5">
            {status.checks.map((check) => (
              <li key={check.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                <span className="font-semibold text-ink">{CHECK_LABEL[check.checkType] ?? check.checkType}</span>
                <span className="text-ink-muted">
                  {STATUS_LABEL[check.status] ?? check.status}
                  {check.maskedId ? ` · ${check.maskedId}` : ""}
                  {" · "}
                  {new Date(check.createdAt).toLocaleDateString()}
                </span>
                {check.failureReason ? (
                  <span className="w-full text-[12px] text-danger">{check.failureReason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </main>
  );
}
