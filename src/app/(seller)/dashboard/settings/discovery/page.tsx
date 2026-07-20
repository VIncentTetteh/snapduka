import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";

import { saveDiscovery } from "./actions";

export default async function DiscoverySettings() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("discovery_preferences")
    .select("*")
    .eq("seller_account_id", actor.sellerAccountId)
    .maybeSingle();

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Seller settings</p>
        <h1 className="page-title mt-1">Buyer discovery</h1>
        <p className="page-sub">
          Discovery is optional. Buyers still check out directly with your shop and carts never mix sellers.
        </p>
      </header>

      <form action={saveDiscovery} className="card grid gap-3">
        <label className="flex items-center gap-3 text-sm font-semibold" style={{ color: "var(--ink)" }}>
          <input defaultChecked={data?.opted_in ?? false} name="optedIn" type="checkbox" />
          List my published shop in discovery
        </label>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="category">Category</label>
          <input
            className="field-input"
            defaultValue={data?.category ?? ""}
            id="category"
            name="category"
            placeholder="Fashion, beauty, home…"
          />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="city">City</label>
          <input
            className="field-input"
            defaultValue={data?.city ?? ""}
            id="city"
            name="city"
            placeholder="City"
          />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="description">Shop description</label>
          <textarea
            className="field-input"
            defaultValue={data?.description ?? ""}
            id="description"
            name="description"
            placeholder="What makes your shop useful?"
            rows={4}
          />
        </div>
        <SubmitButton className="btn-primary w-full" pendingLabel="Saving…">Save discovery settings</SubmitButton>
      </form>
    </main>
  );
}
