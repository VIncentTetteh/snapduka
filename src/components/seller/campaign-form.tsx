import { Field, inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { CampaignRow } from "@/lib/campaigns/campaigns";

/**
 * The campaign's information.
 *
 * Objective is free text rather than a dropdown on purpose: "sell 40 wrappers
 * before Christmas" is a better goal than anything a fixed list of marketing
 * objectives would have offered a seller in Accra.
 *
 * Budget and spend are both entered by hand — SnapDuka has no ad-platform
 * integration, so spend is what the seller says they spent, and pretending
 * otherwise would be worse than asking.
 */
export function CampaignForm({
  action,
  campaign,
  currency,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  campaign?: CampaignRow;
  currency: string;
  submitLabel: string;
}) {
  const money = (minor: number | null | undefined) =>
    minor === null || minor === undefined ? "" : String(minor / 100);

  return (
    <form action={action} className="grid gap-4">
      {campaign ? <input name="campaignId" type="hidden" value={campaign.id} /> : null}

      <Field htmlFor="campaign-name" label="Campaign name">
        <input
          className={inputClasses()}
          defaultValue={campaign?.name ?? ""}
          id="campaign-name"
          maxLength={120}
          name="name"
          placeholder="December Kente drop"
          required
        />
      </Field>

      <Field
        help="What would make this worth doing? Plain words are fine."
        htmlFor="campaign-objective"
        label="Goal"
        optional
      >
        <textarea
          className={inputClasses()}
          defaultValue={campaign?.objective ?? ""}
          id="campaign-objective"
          maxLength={500}
          name="objective"
          placeholder="Sell 40 wrappers before Christmas"
          rows={2}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field htmlFor="campaign-status" label="Status">
          <select
            className={inputClasses()}
            defaultValue={campaign?.status ?? "draft"}
            id="campaign-status"
            name="status"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="ended">Ended</option>
          </select>
        </Field>
        <div />
        <Field htmlFor="campaign-starts" label="Starts" optional>
          <input
            className={inputClasses()}
            defaultValue={campaign?.starts_at ?? ""}
            id="campaign-starts"
            name="starts_at"
            type="date"
          />
        </Field>
        <Field htmlFor="campaign-ends" label="Ends" optional>
          <input
            className={inputClasses()}
            defaultValue={campaign?.ends_at ?? ""}
            id="campaign-ends"
            name="ends_at"
            type="date"
          />
        </Field>
        <Field htmlFor="campaign-budget" label={`Budget (${currency})`} optional>
          <input
            className={inputClasses()}
            defaultValue={money(campaign?.budget_minor)}
            id="campaign-budget"
            inputMode="decimal"
            name="budget"
            placeholder="0.00"
          />
        </Field>
        <Field
          help="What you have actually spent so far."
          htmlFor="campaign-spend"
          label={`Spent (${currency})`}
          optional
        >
          <input
            className={inputClasses()}
            defaultValue={money(campaign?.spend_minor)}
            id="campaign-spend"
            inputMode="decimal"
            name="spend"
            placeholder="0.00"
          />
        </Field>
      </div>

      <Field htmlFor="campaign-notes" label="Notes" optional>
        <textarea
          className={inputClasses()}
          defaultValue={campaign?.notes ?? ""}
          id="campaign-notes"
          maxLength={2000}
          name="notes"
          placeholder="Which creators are posting, what the caption should say…"
          rows={3}
        />
      </Field>

      <SubmitButton className="btn-primary justify-self-start" pendingLabel="Saving…">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
