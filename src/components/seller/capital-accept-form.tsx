"use client";

import { useActionState } from "react";

import { acceptOfferAction, type CapitalActionState } from "@/app/(seller)/dashboard/capital/actions";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: CapitalActionState = { status: "idle" };

type Props = {
  offerId: string;
  expectedTotalMinor: number;
  termsVersion: string;
  /** Formatted principal, e.g. "GH₵2,500.00", for the button label. */
  principalLabel: string;
};

/**
 * Accepting an advance. The seller must tick the box; the button names the
 * exact amount so nobody takes on a debt by clicking something called "Continue".
 * The total and terms version travel with the form so the database can refuse
 * an offer that changed after this page was rendered.
 */
export function CapitalAcceptForm({ offerId, expectedTotalMinor, termsVersion, principalLabel }: Props) {
  const [state, action] = useActionState(acceptOfferAction, initialState);

  if (state.status === "success") {
    return (
      <p className="rounded-[10px] bg-success-tint px-3.5 py-3 text-[12.5px] font-semibold text-success" role="status">
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="offerId" value={offerId} />
      <input type="hidden" name="expectedTotalMinor" value={String(expectedTotalMinor)} />
      <input type="hidden" name="termsVersion" value={termsVersion} />
      <label className="flex items-start gap-2 text-[12.5px] leading-[1.5] text-ink">
        <input type="checkbox" name="confirm" value="yes" required className="mt-0.5" />
        <span>I have read and accept these terms.</span>
      </label>
      <SubmitButton
        className="min-h-10 cursor-pointer justify-self-start rounded-[9px] border-none bg-ink px-4 text-[13px] font-bold text-white transition-colors hover:bg-ink-2 disabled:cursor-wait disabled:opacity-60"
        pendingLabel="Accepting…"
      >
        {`Accept ${principalLabel} advance`}
      </SubmitButton>
      {state.status === "error" && state.message ? (
        <p className="text-[12.5px] text-danger" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
