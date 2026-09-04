import { CAMPAIGN_CHANNELS, CHANNEL_LABEL, shareCaption, shortLinkUrl } from "@snapduka/core";
import { resolveServerActor } from "@/lib/auth/actor";
import { appOrigin } from "@/lib/app-url";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";

import { createCampaign } from "./actions";

/** CHANNEL_LABEL covers the four share channels; campaign links also allow "other". */
function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel as keyof typeof CHANNEL_LABEL] ?? "Other";
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;

  const [{ error }, supabase] = await Promise.all([searchParams, createClient()]);
  const [{ data: shop }, { data: items }] = await Promise.all([
    supabase
      .from("shops")
      .select("slug,display_name")
      .eq("seller_account_id", actor.sellerAccountId)
      .single(),
    supabase
      .from("campaign_links")
      .select("id,name,token,channel,active")
      .eq("seller_account_id", actor.sellerAccountId)
      .eq("active", true)
      .order("created_at", { ascending: false }),
  ]);

  const origin = await appOrigin();
  const caption = shareCaption({ shopName: shop?.display_name ?? "my shop" });

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Growth</p>
        <h1 className="page-title mt-1">Campaign links</h1>
        <p className="page-sub">
          Use these links in Snapchat, TikTok, Instagram, and WhatsApp. No social API connection is required.
        </p>
      </header>

      {error ? <p className="alert-error m-0">{error}</p> : null}

      <form action={createCampaign} className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Create a link</h2>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="campaign-name">Campaign name</label>
          <input className="field-input" id="campaign-name" name="name" placeholder="TikTok June launch" />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="campaign-channel">Channel</label>
          <select className="field-input" id="campaign-channel" name="channel">
            {CAMPAIGN_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {channelLabel(channel)}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className="btn-primary w-full" pendingLabel="Creating…">Create tracked link</SubmitButton>
      </form>

      {items?.map((item) => {
        // The whole point of a tracked link: /l/{token} is what records the
        // click and sets the signed attribution cookie. This page used to hand
        // out `?campaign=<token>` against the storefront, which skips the
        // recorder entirely — no click row, no cookie, no clickId at checkout,
        // so every order from it landed as source='fallback'.
        const url = shortLinkUrl(origin, item.token);
        return (
          <article className="card grid gap-3" key={item.id}>
            <div className="flex items-center justify-between gap-2">
              <strong style={{ color: "var(--ink)" }}>{item.name}</strong>
              <span className="badge badge-stone">{channelLabel(item.channel)}</span>
            </div>
            <div className="grid gap-1">
              <label className="field-label">Tracked link</label>
              <input className="field-input text-sm" readOnly value={url} />
            </div>
            <div className="grid gap-1">
              <label className="field-label">Suggested caption</label>
              <textarea className="field-input text-sm" readOnly rows={3} value={`${caption}\n${url}`} />
            </div>
          </article>
        );
      })}
    </main>
  );
}
