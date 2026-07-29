import { Field, inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

import { updateCreatorProfile } from "./actions";

export const dynamic = "force-dynamic";

export default async function CreatorSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "creator") return null;
  const params = await searchParams;
  const supabase = await createClient();

  const { data: creator } = await supabase
    .from("creators")
    .select("display_name,handle,contact_phone,contact_email,payout_details")
    .eq("id", actor.creatorId)
    .maybeSingle();

  const payout = (creator?.payout_details ?? {}) as Record<string, string>;

  return (
    <main className="sd-main">
      <PageHeader title="Settings" sub="Shops you work with see your name and payout details." />
      {params.error ? (
        <div role="alert" className="mb-4 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3 text-[13px] text-[#7A1B10]">
          {params.error}
        </div>
      ) : null}
      {params.message ? (
        <div role="status" className="mb-4 rounded-[10px] border border-line bg-white px-3.5 py-3 text-[13px] text-ink-soft">
          {params.message}
        </div>
      ) : null}
      <Panel className="px-4 py-4">
        <form action={updateCreatorProfile} className="grid gap-3.5">
          <Field label="Display name" htmlFor="display-name">
            <input className={inputClasses()} defaultValue={creator?.display_name ?? ""} id="display-name" name="displayName" required />
          </Field>
          <Field label="Handle" htmlFor="handle">
            <input className={inputClasses()} defaultValue={creator?.handle ?? ""} disabled id="handle" readOnly />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <input className={inputClasses()} defaultValue={creator?.contact_phone ?? ""} id="phone" name="contactPhone" required />
          </Field>
          <Field
            label="Mobile money name"
            htmlFor="momo-name"
            help="The name registered to the number above, so shops can pay you without asking"
            optional
          >
            <input className={inputClasses()} defaultValue={payout.momoName ?? ""} id="momo-name" name="momoName" />
          </Field>
          <SubmitButton
            className="h-11 cursor-pointer rounded-[10px] border-none bg-accent text-[14px] font-bold text-white hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
            pendingLabel="Saving…"
          >
            Save
          </SubmitButton>
        </form>
      </Panel>
    </main>
  );
}
