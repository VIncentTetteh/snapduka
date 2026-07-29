import { redirect } from "next/navigation";

import { Field, inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";

import { createCreatorProfile } from "./actions";

export const dynamic = "force-dynamic";

/**
 * First-run profile for an authenticated user who has accepted an invite but
 * has no creator row yet. Outside the /creator layout's guard by necessity —
 * the layout redirects here precisely because the profile is missing.
 */
export default async function CreatorStartPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const actor = await resolveServerActor();
  const params = await searchParams;

  if (!actor.authenticated) redirect("/login?next=/creator/start");
  if (actor.kind === "creator") redirect("/creator");
  if (actor.kind === "seller") redirect("/dashboard");

  return (
    <main className="sd-main mx-auto max-w-[440px] px-4 py-10 sm:px-6">
      <PageHeader title="Set up your creator profile" sub="Shops will see this when they invite you." />
      {params.error ? (
        <div role="alert" className="mb-4 rounded-[10px] border border-danger-line bg-danger-tint px-3.5 py-3 text-[13px] text-[#7A1B10]">
          {params.error}
        </div>
      ) : null}
      <Panel className="px-4 py-4">
        <form action={createCreatorProfile} className="grid gap-3.5">
          <input name="next" type="hidden" value={params.next ?? "/creator"} />
          <Field label="Display name" htmlFor="display-name">
            <input className={inputClasses()} id="display-name" name="displayName" placeholder="Ama Sika" required />
          </Field>
          <Field label="Handle" htmlFor="handle" help="Lowercase letters, numbers and underscores">
            <input className={inputClasses()} id="handle" name="handle" placeholder="ama_sika" required />
          </Field>
          <Field label="Phone" htmlFor="phone" help="How the shop pays you">
            <input className={inputClasses()} id="phone" name="contactPhone" placeholder="+233241234567" required />
          </Field>
          <Field label="Country" htmlFor="country">
            <select className={inputClasses()} defaultValue="GH" id="country" name="country">
              <option value="GH">Ghana</option>
              <option value="NG">Nigeria</option>
              <option value="CI">Côte d&rsquo;Ivoire</option>
            </select>
          </Field>
          <SubmitButton
            className="h-11 cursor-pointer rounded-[10px] border-none bg-accent text-[14px] font-bold text-white hover:bg-accent-deep disabled:cursor-wait disabled:bg-[#C08B6E]"
            pendingLabel="Creating…"
          >
            Create profile
          </SubmitButton>
        </form>
      </Panel>
    </main>
  );
}
