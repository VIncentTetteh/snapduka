import { resolveServerActor } from "@/lib/auth/actor";
import { appOrigin } from "@/lib/app-url";
import { campaignUrl } from "@/lib/campaigns/links";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";

import { createCampaign } from "./actions";

export default async function CampaignsPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const [{ data: shop }, { data: items }] = await Promise.all([
    supabase.from("shops").select("slug,display_name").eq("seller_account_id", actor.sellerAccountId).single(),
    supabase.from("campaign_links").select("id,name,token,channel").eq("seller_account_id", actor.sellerAccountId),
  ]);
  const base = `${await appOrigin()}/${shop?.slug ?? ""}`;

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Growth</p>
        <h1 className="page-title mt-1">Campaign links</h1>
        <p className="page-sub">
          Use these links in Snapchat, TikTok, Instagram, and WhatsApp. No social API connection is required.
        </p>
      </header>

      <form action={createCampaign} className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Create a link</h2>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="campaign-name">Campaign name</label>
          <input className="field-input" id="campaign-name" name="name" placeholder="TikTok June launch" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="campaign-channel">Channel</label>
          <select className="field-input" id="campaign-channel" name="channel">
            <option>tiktok</option>
            <option>snapchat</option>
            <option>instagram</option>
            <option>whatsapp</option>
            <option>other</option>
          </select>
        </div>
        <SubmitButton className="btn-primary w-full" pendingLabel="Creating…">Create tracked link</SubmitButton>
      </form>

      {items?.map((item) => {
        const url = campaignUrl(base, item.token);
        return (
          <article className="card grid gap-3" key={item.id}>
            <div className="flex items-center justify-between gap-2">
              <strong style={{ color: "var(--ink)" }}>{item.name}</strong>
              <span className="badge badge-stone capitalize">{item.channel}</span>
            </div>
            <div className="grid gap-1">
              <label className="field-label">Tracked link</label>
              <input className="field-input text-sm" readOnly value={url} />
            </div>
            <div className="grid gap-1">
              <label className="field-label">Suggested caption</label>
              <textarea
                className="field-input text-sm"
                readOnly
                rows={3}
                value={`Shop ${shop?.display_name ?? "my latest products"} here: ${url}`}
              />
            </div>
            <div
              className="grid aspect-[9/16] max-h-64 place-items-center rounded-2xl p-6 text-center text-xl font-black text-white"
              style={{ background: "linear-gradient(135deg, var(--accent) 0%, #c07a14 100%)" }}
            >
              Shop {shop?.display_name}
              <br />
              <span className="mt-1 text-sm opacity-80">Tap the link to order</span>
            </div>
          </article>
        );
      })}
    </main>
  );
}
