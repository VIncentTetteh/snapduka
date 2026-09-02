import { LogoUploader } from "@/components/seller/logo-uploader";
import { UpgradePrompt } from "@/components/seller/upgrade-prompt";
import { SubmitButton } from "@/components/ui/submit-button";
import { domainChallenge } from "@/lib/domains/verification";
import { publicMediaUrl } from "@/lib/storefront/media";
import { resolveServerActor } from "@/lib/auth/actor";
import { getSellerPlan, planAllows } from "@/lib/billing/resolve";
import { createClient } from "@/lib/supabase/server";

import { addCustomDomain, saveBranding, saveStorefrontContact, verifyCustomDomain } from "./actions";

export default async function BrandingPage() {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const supabase = await createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id,slug")
    .eq("seller_account_id", actor.sellerAccountId)
    .single();
  const [{ data: branding }, { data: domains }, plan] = await Promise.all([
    supabase.from("shop_branding").select("*").eq("shop_id", shop?.id ?? "").maybeSingle(),
    supabase.from("custom_domains").select("id,hostname,status,verification_token,last_checked_at").eq("shop_id", shop?.id ?? ""),
    getSellerPlan(actor.sellerAccountId),
  ]);
  const themingAllowed = planAllows(plan, "branding");
  const domainAllowed = planAllows(plan, "customDomain");

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-3 py-5 pb-16">
      <header>
        <p className="page-eyebrow m-0">Growth</p>
        <h1 className="page-title mt-1">Brand and domain</h1>
        <p className="page-sub">Your SnapDuka URL always remains available while a custom domain is pending.</p>
      </header>

      <section className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Logo</h2>
        <LogoUploader currentLogoUrl={publicMediaUrl(branding?.logo_path, "shop-logos")} />
      </section>

      {/* Not gated on the plan: theming is a paid extra, being reachable is not. */}
      <form action={saveStorefrontContact} className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>WhatsApp for buyers</h2>
        <p className="m-0 text-[13px] leading-[1.6]" style={{ color: "var(--ink-soft)" }}>
          Shown on every product page so a buyer can ask before they order. Leave it
          empty and no WhatsApp line appears at all. This is published on your public
          storefront, so use the number you are happy for customers to see.
        </p>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="whatsapp">WhatsApp number</label>
          <input
            className="field-input"
            defaultValue={branding?.whatsapp_number ?? ""}
            id="whatsapp"
            inputMode="tel"
            name="whatsapp"
            placeholder="024 123 4567"
            type="tel"
          />
        </div>
        <SubmitButton className="btn btn-primary justify-self-start" pendingLabel="Saving…">
          Save contact
        </SubmitButton>
      </form>

      {!themingAllowed ? (
        <UpgradePrompt feature="Storefront theming" planName={plan.planName} />
      ) : (
      <form action={saveBranding} className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Theme</h2>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="accent">Accent color</label>
          <input
            className="field-input"
            defaultValue={branding?.accent_color ?? "#146b45"}
            id="accent"
            name="accent"
            type="color"
          />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="surface">Surface color</label>
          <input
            className="field-input"
            defaultValue={branding?.surface_color ?? "#ffffff"}
            id="surface"
            name="surface"
            type="color"
          />
        </div>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="font">Font</label>
          <select className="field-input" defaultValue={branding?.font_family ?? "system"} id="font" name="font">
            <option value="system">System</option>
            <option value="rounded">Rounded</option>
            <option value="serif">Serif</option>
          </select>
        </div>
        <SubmitButton className="btn-primary w-full" pendingLabel="Saving theme…">Save theme</SubmitButton>
      </form>
      )}

      {!domainAllowed ? (
        <UpgradePrompt feature="Custom domains" planName={plan.planName} />
      ) : (
      <form action={addCustomDomain} className="card grid gap-3">
        <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>Custom domain</h2>
        <div className="grid gap-1">
          <label className="field-label" htmlFor="hostname">Domain</label>
          <input className="field-input" id="hostname" name="hostname" placeholder="shop.example.com" />
        </div>
        <SubmitButton className="btn-primary w-full" pendingLabel="Adding…">Add domain</SubmitButton>
      </form>
      )}

      {domains?.map((domain) => {
        const challenge = domainChallenge(domain.verification_token);
        return (
          <article className="card" key={domain.hostname}>
            <div className="flex items-center justify-between gap-2">
              <strong style={{ color: "var(--ink)" }}>{domain.hostname}</strong>
              <span className={`badge ${domain.status === "verified" ? "badge-green" : domain.status === "failed" ? "badge-red" : "badge-amber"}`}>
                {domain.status}
              </span>
            </div>
            <p className="m-0 mt-2 text-sm" style={{ color: "var(--ink-2)" }}>DNS record:</p>
            <code
              className="mt-1 block rounded-lg px-3 py-2 text-xs"
              style={{ background: "var(--accent-lite)", color: "var(--accent)" }}
            >
              {challenge.name} {challenge.type} {challenge.value}
            </code>
            {domain.status !== "verified" && (
              <form action={verifyCustomDomain} className="mt-3">
                <input name="domainId" type="hidden" value={domain.id} />
                <SubmitButton className="btn-secondary text-sm" pendingLabel="Checking…">Check DNS</SubmitButton>
              </form>
            )}
            {domain.last_checked_at && <p className="m-0 mt-2 text-xs" style={{ color: "var(--ink-3)" }}>Last checked {new Date(domain.last_checked_at).toLocaleString()}</p>}
          </article>
        );
      })}
    </main>
  );
}
