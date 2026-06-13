import { domainChallenge } from "@/lib/domains/verification";
import { resolveServerActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";

import { addCustomDomain, saveBranding } from "./actions";

export default async function BrandingPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const { data: shop } = await supabase.from("shops").select("id,slug").eq("seller_account_id", actor.sellerAccountId).single();
  const [{ data: branding }, { data: domains }] = await Promise.all([
    supabase.from("shop_branding").select("*").eq("shop_id", shop?.id ?? "").maybeSingle(),
    supabase.from("custom_domains").select("hostname,status,verification_token").eq("shop_id", shop?.id ?? ""),
  ]);
  return <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-24"><header><p className="font-bold uppercase tracking-wide text-emerald-900">Growth</p><h1 className="m-0 text-4xl font-black">Brand and domain</h1><p>Your SnapDuka URL always remains available while a custom domain is pending.</p></header><form action={saveBranding} className="grid gap-3 rounded-3xl border bg-white p-5"><label>Accent color<input className="min-h-12 w-full rounded-xl border p-3" defaultValue={branding?.accent_color ?? "#146b45"} name="accent"/></label><label>Surface color<input className="min-h-12 w-full rounded-xl border p-3" defaultValue={branding?.surface_color ?? "#ffffff"} name="surface"/></label><label>Font<select className="min-h-12 w-full rounded-xl border p-3" defaultValue={branding?.font_family ?? "system"} name="font"><option value="system">System</option><option value="rounded">Rounded</option><option value="serif">Serif</option></select></label><button className="primaryAction">Save theme</button></form><form action={addCustomDomain} className="grid gap-3 rounded-3xl border bg-white p-5"><h2 className="m-0">Custom domain</h2><input className="min-h-12 rounded-xl border p-3" name="hostname" placeholder="shop.example.com"/><button className="primaryAction">Add domain</button></form>{domains?.map((domain) => { const challenge=domainChallenge(domain.verification_token); return <article className="rounded-2xl border bg-white p-4" key={domain.hostname}><strong>{domain.hostname}</strong><p className="capitalize">{domain.status}</p><code>{challenge.name} {challenge.type} {challenge.value}</code></article>; })}</main>;
}
