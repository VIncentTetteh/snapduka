import { CampaignForm } from "@/components/seller/campaign-form";
import { PageHeader, Panel } from "@/components/ui/surface";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

import { createCampaignRecord } from "../campaign-actions";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;

  const [{ error }, supabase] = await Promise.all([searchParams, createClient()]);
  const { data: shop } = await supabase
    .from("shops")
    .select("currency")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();

  return (
    <main className="sd-main mx-auto max-w-[720px] px-4 pt-6 sm:px-6">
      <PageHeader
        eyebrow="Growth"
        title="New campaign"
        sub="Name it and set a goal. The creative and the links come next."
      />

      {error ? <p className="alert-error mb-4">{error}</p> : null}

      <Panel className="p-4.5">
        <CampaignForm
          action={createCampaignRecord}
          currency={shop?.currency ?? "GHS"}
          submitLabel="Create campaign"
        />
      </Panel>
    </main>
  );
}
