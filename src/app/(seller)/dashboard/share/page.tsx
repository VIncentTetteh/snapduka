import Link from "next/link";
import QRCode from "qrcode";

import { disconnectSocialAccountAction, generateShareLinksAction } from "./actions";
import { inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  isSocialProviderConfigured,
  PROVIDER_LABEL,
  SOCIAL_PROVIDERS,
} from "@/lib/social/providers";
import { NativeShareButtonClient } from "@/components/seller/native-share-button-client";
import { ShareButtons } from "@/components/seller/share-buttons";
import { TrackedLinkShare } from "@/components/seller/tracked-link-share";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/surface";
import { appOrigin } from "@/lib/app-url";
import { resolveServerActor } from "@/lib/auth/actor";
import { formatMoney } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@/lib/countries/types";
import { fetchAnalyticsSummary } from "@/lib/analytics/summary";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "share", label: "Share a product" },
  { id: "posts", label: "Posts" },
  { id: "accounts", label: "Accounts" },
  { id: "analytics", label: "Analytics" },
] as const;

const PRODUCT_PICKER_LIMIT = 24;

const CHANNEL_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  snapchat: "Snapchat",
  whatsapp: "WhatsApp",
  other: "Other",
};

export default async function ShareStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; product?: string; q?: string }>;
}) {
  const actor = await resolveServerActor();
  if (actor.kind !== "seller") return null;
  const params = await searchParams;
  const tab = TABS.some((t) => t.id === params.tab) ? params.tab! : "share";
  const origin = await appOrigin();
  const originHost = new URL(origin).host;
  const supabase = await createClient();
  // The picker is a horizontal strip, so it stays a shortlist; search is how a
  // seller reaches anything outside it. PostgREST would cap us anyway.
  const productSearch = (params.q ?? "").trim().slice(0, 60);

  const [{ data: shop }, { data: products }, { data: links }, { data: attributions }, summary, { count: paidOrders }] =
    await Promise.all([
      supabase
        .from("shops")
        .select("id,slug,display_name")
        .eq("seller_account_id", actor.sellerAccountId)
        .maybeSingle(),
      productSearch
        ? supabase
            .from("products")
            .select("id,name,currency,price_minor,video_url")
            .eq("seller_account_id", actor.sellerAccountId)
            .eq("status", "active")
            .ilike("name", `%${productSearch}%`)
            .order("name")
            .limit(PRODUCT_PICKER_LIMIT)
        : supabase
            .from("products")
            .select("id,name,currency,price_minor,video_url")
            .eq("seller_account_id", actor.sellerAccountId)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(PRODUCT_PICKER_LIMIT),
      supabase
        .from("campaign_links")
        .select("id,name,token,channel,destination_path,active")
        .eq("seller_account_id", actor.sellerAccountId)
        .eq("active", true)
        .order("created_at", { ascending: false }),
      supabase.rpc("campaign_link_totals"),
      fetchAnalyticsSummary(),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("seller_account_id", actor.sellerAccountId)
        .eq("payment_status", "paid"),
    ]);
  const { data: socialAccounts } = await supabase
    .from("social_accounts")
    .select("provider, handle, status, connected_at")
    .eq("seller_account_id", actor.sellerAccountId);

  if (!shop) {
    return (
      <main className="sd-main mx-auto max-w-[1040px] px-4 pt-6 sm:px-6">
        <PageHeader title="Share Studio" />
        <EmptyState
          title="Publish your shop first"
          body="Finish onboarding to get your store link, captions and tracked short links."
        />
      </main>
    );
  }

  // Looking the selection up only inside the shortlist meant a link to any
  // product outside it silently shared the storefront instead. Fetch it
  // directly when the shortlist does not happen to contain it.
  const listedProduct = products?.find((product) => product.id === params.product) ?? null;
  const { data: fetchedProduct } = params.product && !listedProduct
    ? await supabase
        .from("products")
        .select("id,name,currency,price_minor,video_url")
        .eq("seller_account_id", actor.sellerAccountId)
        .eq("status", "active")
        .eq("id", params.product)
        .maybeSingle()
    : { data: null };
  const selectedProduct = listedProduct ?? fetchedProduct;
  const destinationPath = selectedProduct
    ? `/${shop.slug}/products/${selectedProduct.id}`
    : `/${shop.slug}`;
  const destinationLabel = selectedProduct?.name ?? "Storefront";
  const storeUrl = `${origin}/${shop.slug}`;
  const targetUrl = selectedProduct ? `${origin}${destinationPath}` : storeUrl;

  // Grouped in Postgres — reducing the raw rows here stopped counting past
  // PostgREST's 1000-row cap. The conversion/click split lives in the RPC now:
  // a row with an order_id is a conversion, not a click.
  const clicksByCampaign = (attributions ?? []).reduce<Record<string, { clicks: number; orders: number }>>(
    (acc, row) => {
      acc[row.campaign_id] = { clicks: row.clicks, orders: row.orders };
      return acc;
    },
    {},
  );

  const destinationLinks = (links ?? []).filter((link) => link.destination_path === destinationPath);
  const caption = selectedProduct
    ? `${selectedProduct.name} — ${formatMoney(selectedProduct.price_minor, selectedProduct.currency as CurrencyCode)}. Order in two taps, pay securely with Paystack. 🛍️${selectedProduct.video_url ? `\nWatch: ${selectedProduct.video_url}` : ""}`
    : `Shop ${shop.display_name} — secure Paystack checkout, no account needed. 🛍️`;

  const qrDataUrl = await QRCode.toDataURL(targetUrl, { width: 480, margin: 2 });

  const totalClicks = (attributions ?? []).reduce((sum, row) => sum + row.clicks, 0);
  const visits = summary.visits;
  const checkoutStarts = summary.checkoutStarts;

  const clicksByChannel = (links ?? []).reduce<Record<string, number>>((acc, link) => {
    acc[link.channel] = (acc[link.channel] ?? 0) + (clicksByCampaign[link.id]?.clicks ?? 0);
    return acc;
  }, {});

  const tabHref = (id: string) => {
    const qs = new URLSearchParams();
    if (id !== "share") qs.set("tab", id);
    if (params.product) qs.set("product", params.product);
    const suffix = qs.toString();
    return `/dashboard/share${suffix ? `?${suffix}` : ""}`;
  };

  return (
    <main className="sd-main mx-auto max-w-[1120px] px-4 pt-6 sm:px-6">
      <PageHeader
        eyebrow="Growth"
        title="Share Studio"
        sub="One polished workspace to prepare, publish and measure every product campaign."
        actions={
          <a
            href={storeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center rounded-[10px] border border-line-strong bg-white px-4 text-[13px] font-semibold text-ink no-underline transition-colors hover:border-[#B9AC98]"
          >
            View storefront ↗
          </a>
        }
      />

      {/* Tabs */}
      <nav aria-label="Share Studio sections" className="mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1 shadow-[0_4px_16px_rgba(57,44,31,0.035)]">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={tabHref(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`inline-flex min-h-9 items-center whitespace-nowrap rounded-lg px-3.5 text-[13px] no-underline transition-colors ${
              tab === t.id
                ? "bg-ink font-bold text-white shadow-sm"
                : "font-semibold text-ink-muted hover:bg-raised hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "share" ? (
        <>
          <Panel className="mb-5 p-4 sm:p-4.5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[11.5px] font-bold uppercase tracking-[0.07em] text-accent">Campaign destination</p>
                <h2 className="mt-1 text-[14px] font-bold text-ink">Choose what you want to share</h2>
              </div>
              <p className="max-w-[42ch] truncate font-mono text-[11.5px] text-ink-muted">{targetUrl}</p>
            </div>
            <form className="mb-3 flex gap-2" role="search">
              <input
                aria-label="Search your products"
                className={inputClasses(false, "flex-1")}
                defaultValue={productSearch}
                name="q"
                placeholder="Search your products…"
                type="search"
              />
              <SubmitButton
                className="min-h-11 flex-none cursor-pointer rounded-[10px] border border-line-input bg-white px-4 text-[13px] font-semibold text-ink transition-colors hover:border-[#B9AC98] disabled:cursor-wait disabled:opacity-60"
                pendingLabel="Searching…"
              >
                Search
              </SubmitButton>
            </form>
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              <Link
                href="/dashboard/share"
                aria-current={!selectedProduct ? "page" : undefined}
                className={`flex h-10 flex-none items-center whitespace-nowrap rounded-full border px-4 text-[13px] font-semibold no-underline ${
                  !selectedProduct
                    ? "border-accent bg-accent-tint text-accent-deep"
                    : "border-line-input bg-white text-ink-soft hover:border-[#B9AC98]"
                }`}
              >
                Storefront
              </Link>
              {(products ?? []).map((product) => (
                <Link
                  key={product.id}
                  href={`/dashboard/share?product=${product.id}`}
                  aria-current={selectedProduct?.id === product.id ? "page" : undefined}
                  className={`flex h-10 flex-none items-center whitespace-nowrap rounded-full border px-4 text-[13px] font-semibold no-underline ${
                    selectedProduct?.id === product.id
                      ? "border-accent bg-accent-tint text-accent-deep"
                      : "border-line-input bg-white text-ink-soft hover:border-[#B9AC98]"
                  }`}
                >
                  {product.name}
                </Link>
              ))}
            </div>
            {productSearch && (products ?? []).length === 0 ? (
              <p className="mt-2.5 text-[12.5px] text-ink-muted">
                No active product matches “{productSearch}”.{" "}
                <Link className="font-semibold text-accent no-underline" href="/dashboard/share">
                  Clear search
                </Link>
              </p>
            ) : null}
          </Panel>

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_340px]">
            <div className="grid gap-4">
              {/* Share now */}
              <Panel className="overflow-hidden border-[#E8D8C6] bg-[linear-gradient(135deg,#FFF8F1_0%,#FFFFFF_65%)] p-4.5">
                <div className="mb-4 flex items-start gap-3">
                  <span aria-hidden="true" className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent text-white">
                    <svg fill="none" height="18" viewBox="0 0 20 20" width="18"><path d="M13.5 6.5 6.8 9.6m0 .9 6.7 3M16 5a2.2 2.2 0 1 1-4.4 0A2.2 2.2 0 0 1 16 5ZM8.4 10a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Zm7.6 5a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" /></svg>
                  </span>
                  <div>
                    <h2 className="text-[14px] font-bold">Share {destinationLabel}</h2>
                    <p className="mt-1 text-[12.5px] text-ink-muted">
                  Each button uses that channel&rsquo;s tracked link, so clicks and orders are
                  attributed automatically.
                    </p>
                  </div>
                </div>
                <ShareButtons
                  caption={caption}
                  links={destinationLinks.map((link) => ({
                    channel: link.channel,
                    shortUrl: `${origin}/l/${link.token}`,
                  }))}
                  shopName={shop.display_name}
                  storeUrl={targetUrl}
                  storyCardUrl={`/api/share/story-card${selectedProduct ? `?product=${selectedProduct.id}` : ""}`}
                />
              </Panel>

              {/* Tracked links */}
              <Panel className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4.5 py-3.5">
                  <h2 className="text-[14px] font-bold">Tracked links · {destinationLabel}</h2>
                </div>
                {destinationLinks.length === 0 ? (
                  <div className="grid place-items-center gap-3 px-4.5 py-8 text-center">
                    <p className="text-[13.5px] text-ink-soft">
                      Create one short link per channel so you can see exactly where orders come
                      from.
                    </p>
                    <form action={generateShareLinksAction}>
                      <input name="destinationPath" type="hidden" value={destinationPath} />
                      <input name="label" type="hidden" value={destinationLabel} />
                      <SubmitButton
                        className="min-h-10 cursor-pointer rounded-[10px] border-none bg-accent px-4.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:opacity-60"
                        pendingLabel="Generating…"
                      >
                        Generate share links
                      </SubmitButton>
                    </form>
                  </div>
                ) : (
                  destinationLinks.map((link) => {
                    const stats = clicksByCampaign[link.id] ?? { clicks: 0, orders: 0 };
                    const shortUrl = `${origin}/l/${link.token}`;
                    return (
                      <div
                        key={link.id}
                        className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0"
                      >
                        <span className="min-w-0">
                          <span className="block text-[13px] font-bold text-ink">
                            {CHANNEL_LABEL[link.channel] ?? link.channel}
                          </span>
                          <span className="block truncate font-mono text-[12px] text-ink-muted">
                            {originHost}/l/{link.token}
                          </span>
                          <span className="block text-[11.5px] text-ink-faint">
                            {stats.clicks} {stats.clicks === 1 ? "click" : "clicks"} · {stats.orders}{" "}
                            {stats.orders === 1 ? "order" : "orders"}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <TrackedLinkShare
                            caption={caption}
                            channel={link.channel}
                            shortUrl={shortUrl}
                          />
                          <CopyButton value={shortUrl} />
                        </span>
                      </div>
                    );
                  })
                )}
              </Panel>

              {/* Caption */}
              <Panel className="overflow-hidden bg-ink p-4.5 text-white">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <h2 className="text-[14px] font-bold">Caption</h2>
                  <CopyButton value={`${caption}\n${targetUrl}`} label="Copy caption" />
                </div>
                <p className="rounded-xl border border-line bg-raised px-4 py-3.5 text-[13.5px] leading-[1.6] text-ink-2">
                  {caption}
                  <br />
                  <span className="font-mono text-[12.5px] text-accent">{targetUrl}</span>
                </p>
              </Panel>
            </div>

            <div className="grid gap-4">
              {/* Story card */}
              <Panel className="p-4.5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div><h2 className="text-[14px] font-bold text-white">Story card</h2><p className="mt-0.5 text-[11.5px] text-[#BDB3A8]">Ready for Stories, Reels and Status</p></div>
                  <a
                    href={`/api/share/story-card${selectedProduct ? `?product=${selectedProduct.id}` : ""}`}
                    download={`snapduka-story-${selectedProduct?.id ?? shop.slug}.png`}
                    className="inline-flex min-h-9 items-center rounded-[9px] border border-white/20 bg-white/10 px-3 text-[12.5px] font-semibold text-white no-underline transition-colors hover:bg-white/15"
                  >
                    Download
                  </a>
                </div>
                {/* Server-generated 1080×1920 image with the product photo as background */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/share/story-card${selectedProduct ? `?product=${selectedProduct.id}` : ""}`}
                  alt={`Story card for ${selectedProduct?.name ?? shop.display_name}`}
                  className="mx-auto w-full max-w-[220px] rounded-2xl border border-white/15 shadow-[0_18px_45px_rgba(0,0,0,0.28)]"
                />
                <p className="mt-3 text-center text-[11.5px] text-[#BDB3A8]">
                  1080×1920 — download and post to TikTok, Reels, Snapchat or Status.
                </p>
              </Panel>

              {/* QR */}
              <Panel className="p-4.5 text-center">
                <h2 className="mb-3 text-left text-[14px] font-bold">QR code</h2>
                {/* Data-URI QR generated server-side */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt={`QR code linking to ${targetUrl}`}
                  className="mx-auto h-40 w-40 rounded-xl border border-line bg-white p-2"
                />
                <p className="mt-2 text-[11.5px] text-ink-muted">
                  Print it, stick it on packaging, or show it at your stall.
                </p>
              </Panel>
            </div>
          </div>
        </>
      ) : null}

      {tab === "posts" ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel className="p-4.5">
            <h2 className="mb-1 text-[14px] font-bold">New post</h2>
            <p className="mb-3 text-[12.5px] text-ink-muted">
              Draft once, post everywhere. Copy the caption and share natively until accounts are
              connected.
            </p>
            <textarea
              rows={4}
              readOnly
              defaultValue={`${caption}\n${targetUrl}`}
              className="mb-3 w-full resize-y rounded-[10px] border border-line-input bg-white px-3.5 py-3 text-[13.5px] text-ink"
            />
            <div className="mb-3 flex flex-wrap gap-2">
              {["TikTok", "Instagram", "Snapchat"].map((channel) => (
                <Badge key={channel} tone="neutral">
                  {channel}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <NativeShareButtonClient
                className="inline-flex min-h-9 cursor-pointer items-center rounded-[9px] border-none bg-accent px-3.5 text-[12.5px] font-bold text-white transition-colors hover:bg-accent-deep disabled:cursor-wait disabled:opacity-60"
                fallback={
                  <p className="m-0 flex items-center text-[12px] text-ink-muted">
                    Open this page on your phone to attach the product photo directly.
                  </p>
                }
                fallbackUrl={targetUrl}
                imageFilename="snapduka-story.png"
                imageUrl={`/api/share/story-card${selectedProduct ? `?product=${selectedProduct.id}` : ""}`}
                label="Share photo + caption…"
                pendingLabel="Preparing…"
                text={`${caption}\n${targetUrl}`}
                title={shop.display_name}
              />
              <CopyButton value={`${caption}\n${targetUrl}`} label="Copy caption" />
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`${caption}\n${targetUrl}`)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center rounded-[9px] bg-success px-3.5 text-[12.5px] font-bold text-white no-underline transition-colors hover:bg-success-deep"
              >
                Share to WhatsApp Status
              </a>
            </div>
          </Panel>
          <Panel className="p-4.5">
            <h2 className="mb-3 text-[14px] font-bold">Recent posts</h2>
            <EmptyState
              title="No posts yet"
              body="Posts you draft and publish will appear here with their status."
            />
          </Panel>
        </div>
      ) : null}

      {tab === "accounts" ? (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {SOCIAL_PROVIDERS.map((provider) => {
            const account = socialAccounts?.find((row) => row.provider === provider);
            const configured = isSocialProviderConfigured(provider);
            return (
              <Panel key={provider} className="p-4.5">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <h2 className="text-[14.5px] font-bold text-ink">{PROVIDER_LABEL[provider]}</h2>
                  <Badge tone={account ? "success" : "neutral"}>
                    {account ? "Connected" : configured ? "Not connected" : "Coming soon"}
                  </Badge>
                </div>
                {account ? (
                  <>
                    <p className="mb-3 text-[12.5px] leading-[1.55] text-ink-soft">
                      {account.handle || "Account"} · connected{" "}
                      {new Date(account.connected_at).toLocaleDateString()}
                    </p>
                    <form action={disconnectSocialAccountAction}>
                      <input name="provider" type="hidden" value={provider} />
                      <SubmitButton
                        className="min-h-9 cursor-pointer rounded-[9px] border border-danger-line bg-white px-3 text-[12.5px] font-semibold text-danger transition-colors hover:bg-danger-tint disabled:cursor-wait disabled:opacity-60"
                        pendingLabel="Disconnecting…"
                      >
                        Disconnect
                      </SubmitButton>
                    </form>
                  </>
                ) : configured ? (
                  <>
                    <p className="mb-3 text-[12.5px] leading-[1.55] text-ink-soft">
                      Connect to publish directly from SnapDuka.
                    </p>
                    <a
                      href={`/api/social/connect/${provider}`}
                      className="inline-flex min-h-9 items-center rounded-[9px] border-none bg-accent px-3.5 text-[12.5px] font-bold text-white no-underline transition-colors hover:bg-accent-deep"
                    >
                      Connect {PROVIDER_LABEL[provider]}
                    </a>
                  </>
                ) : (
                  <>
                    <p className="mb-3 text-[12.5px] leading-[1.55] text-ink-soft">
                      Direct publishing unlocks once SnapDuka&rsquo;s{" "}
                      {provider === "tiktok" ? "TikTok" : "Meta"} developer app is approved. Until
                      then, use your tracked {PROVIDER_LABEL[provider]} link and caption from the
                      Share tab.
                    </p>
                    <Link
                      href="/dashboard/share"
                      className="text-[12.5px] font-bold text-accent no-underline hover:text-accent-deep"
                    >
                      Prepare &amp; share →
                    </Link>
                  </>
                )}
              </Panel>
            );
          })}
          <Panel className="p-4.5">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 className="text-[14.5px] font-bold text-ink">Snapchat</h2>
              <Badge tone="neutral">Share only</Badge>
            </div>
            <p className="mb-3 text-[12.5px] leading-[1.55] text-ink-soft">
              Snapchat has no public posting API — use your tracked Snapchat link and the story
              card from the Share tab.
            </p>
            <Link
              href="/dashboard/share"
              className="text-[12.5px] font-bold text-accent no-underline hover:text-accent-deep"
            >
              Prepare &amp; share →
            </Link>
          </Panel>
        </div>
      ) : null}

      {tab === "analytics" ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel className="p-4.5">
            <h2 className="mb-1 text-[14px] font-bold">Link funnel</h2>
            <p className="mb-4 text-[12.5px] text-ink-muted">All time</p>
            {[
              { label: "Link clicks", value: totalClicks },
              { label: "Storefront visits", value: visits },
              { label: "Checkout starts", value: checkoutStarts },
              { label: "Paid orders", value: paidOrders ?? 0 },
            ].map((step, index, list) => {
              const top = list[0].value || 1;
              const pct = Math.round((step.value / top) * 100);
              return (
                <div key={step.label} className="mb-3 last:mb-0">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-semibold text-ink">{step.label}</span>
                    <span className="text-[13px] font-bold text-ink">
                      {step.value.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-line-soft">
                    <div
                      className={`h-full rounded-full ${index === list.length - 1 ? "bg-success" : "bg-accent-soft"}`}
                      style={{ width: `${Math.max(pct, step.value > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </Panel>

          <Panel className="overflow-hidden">
            <h2 className="border-b border-line-soft px-4.5 py-3.5 text-[14px] font-bold">
              Clicks by channel
            </h2>
            {Object.keys(clicksByChannel).length === 0 ? (
              <p className="px-4.5 py-8 text-center text-[13px] text-ink-soft">
                Generate share links and start posting to see channel performance.
              </p>
            ) : (
              Object.entries(clicksByChannel)
                .sort(([, a], [, b]) => b - a)
                .map(([channel, clicks]) => (
                  <div
                    key={channel}
                    className="flex items-center justify-between gap-3 border-b border-[#F7F2EA] px-4.5 py-3 last:border-b-0"
                  >
                    <span className="text-[13.5px] font-semibold text-ink">
                      {CHANNEL_LABEL[channel] ?? channel}
                    </span>
                    <span className="text-[13.5px] font-bold text-ink">
                      {clicks.toLocaleString()}
                    </span>
                  </div>
                ))
            )}
          </Panel>
        </div>
      ) : null}
    </main>
  );
}
