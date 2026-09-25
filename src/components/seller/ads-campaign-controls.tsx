"use client";

import { useActionState } from "react";

import { changeCampaignAction, type AdsActionState } from "@/app/(seller)/dashboard/ads/actions";
import { FormActionButton } from "@/components/ui/submit-button";

const initialState: AdsActionState = { status: "idle" };

type Props = {
  campaignId: string;
  state: "active" | "paused" | "out_of_funds" | "ended";
};

const BUTTON =
  "min-h-8 cursor-pointer rounded-[8px] border border-line bg-white px-3 text-[12px] font-bold text-ink disabled:cursor-wait disabled:opacity-60";

/** Pause / resume / end for one campaign. Ended is terminal, so it shows nothing. */
export function AdsCampaignControls({ campaignId, state }: Props) {
  const [result, action] = useActionState(changeCampaignAction, initialState);
  if (state === "ended") return null;

  return (
    <div className="mt-2.5">
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="campaignId" value={campaignId} />
        {state === "paused" ? (
          <FormActionButton name="action" value="resume" pendingLabel="Resuming…" className={BUTTON}>
            Resume
          </FormActionButton>
        ) : (
          <FormActionButton name="action" value="pause" pendingLabel="Pausing…" className={BUTTON}>
            Pause
          </FormActionButton>
        )}
        <FormActionButton name="action" value="end" pendingLabel="Ending…" className={`${BUTTON} text-danger`}>
          End
        </FormActionButton>
      </form>
      {result.status === "error" && result.message ? (
        <p className="mt-1.5 text-[12px] text-danger" role="status">
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
